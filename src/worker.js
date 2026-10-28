// The Garden API. Static files (public/) are served by Workers Assets and
// hold no personal data; only /api/* reaches this code (run_worker_first in
// wrangler.jsonc), and every /api route except login needs a signed session.
//
// Lock: one passcode, stored as the Worker secret GARDEN_PASSCODE. A correct
// passcode sets a signed, HttpOnly cookie good for a year. Changing the
// passcode signs out every device, because the passcode is part of the
// signing key. If the secrets are missing, every call is refused.
//
// Guessing: each wrong try is recorded in D1. 5 misses from one IP in 15
// minutes locks that IP out; 30 misses from anywhere in an hour locks login
// for everyone until the hour passes (devices already signed in keep working).

const ID_RE = /^[a-z0-9]{6,40}$/;
const MAX_BODY = 200_000;
const COOKIE = "garden_session";
const SESSION_DAYS = 365;
const IP_LIMIT = 5, IP_WINDOW_MIN = 15;
const GLOBAL_LIMIT = 30, GLOBAL_WINDOW_MIN = 60;
import "../public/setup.js"; // sets globalThis.GARDEN_SETUP

const MIN_PASSCODE = 12;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    try {
      if (!configured(env)) return json({ error: "lock not configured" }, 503);
      if (url.pathname === "/api/login" && request.method === "POST") return await login(request, env);
      if (url.pathname === "/api/logout" && request.method === "POST") return logout();
      if (url.pathname.startsWith("/api/shortcut/")) return await shortcutRoute(request, env, url);
      if (!(await validSession(request, env))) return json({ error: "signed out" }, 401);
      if (url.pathname === "/api/shortcut-key") return await shortcutKeyRoute(request, env);
      if (url.pathname === "/api/garden-config") return await configRoute(request, env);
      return await route(request, env, url);
    } catch (e) {
      console.error(e);
      return json({ error: "server error" }, 500);
    }
  },
};

function configured(env) {
  return typeof env.GARDEN_PASSCODE === "string" && env.GARDEN_PASSCODE.length >= MIN_PASSCODE &&
    typeof env.SESSION_SECRET === "string" && env.SESSION_SECRET.length >= 32;
}

// ---------- plants ----------

async function route(request, env, url) {
  const parts = url.pathname.split("/").filter(Boolean); // ["api","plants",id?,"conversations"?]
  if (parts[1] !== "plants" || parts.length > 4) return json({ error: "not found" }, 404);
  const id = parts[2] ? decodeURIComponent(parts[2]) : null;
  if (id !== null && !ID_RE.test(id)) return json({ error: "bad id" }, 400);
  const m = request.method;

  // Appending on the server (not replacing the whole list from the page)
  // keeps a call logged by the Shortcut from being wiped by a stale page.
  if (id && parts[3] === "conversations" && m === "POST") {
    const convo = await readBody(request);
    if (!convo) return json({ error: "bad body" }, 400);
    const row = await env.DB.prepare("SELECT data FROM plants WHERE id = ?").bind(id).first();
    if (!row) return json({ error: "not found" }, 404);
    const data = JSON.parse(row.data);
    data.conversations = (data.conversations || []).concat([convo]);
    if (!data.lastContactDate || Date.parse(convo.date) > Date.parse(data.lastContactDate)) data.lastContactDate = convo.date;
    await env.DB.prepare("UPDATE plants SET data = ?, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify(data), new Date().toISOString(), id).run();
    return new Response(null, { status: 204 });
  }
  if (parts.length > 3) return json({ error: "not found" }, 404);

  if (!id && m === "GET") {
    const { results } = await env.DB.prepare("SELECT id, data FROM plants").all();
    return json(results.map((r) => ({ ...JSON.parse(r.data), id: r.id })));
  }

  if (!id && m === "POST") {
    const doc = await readBody(request);
    if (!doc) return json({ error: "bad body" }, 400);
    const newId = typeof doc.id === "string" && ID_RE.test(doc.id) ? doc.id : crypto.randomUUID().replace(/-/g, "");
    delete doc.id;
    await env.DB.prepare("INSERT INTO plants (id, data, updated_at) VALUES (?, ?, ?)")
      .bind(newId, JSON.stringify(doc), new Date().toISOString()).run();
    return json({ id: newId }, 201);
  }

  if (id && m === "PATCH") {
    const patch = await readBody(request);
    if (!patch) return json({ error: "bad body" }, 400);
    delete patch.id;
    const row = await env.DB.prepare("SELECT data FROM plants WHERE id = ?").bind(id).first();
    if (!row) return json({ error: "not found" }, 404);
    const merged = { ...JSON.parse(row.data), ...patch };
    await env.DB.prepare("UPDATE plants SET data = ?, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify(merged), new Date().toISOString(), id).run();
    return new Response(null, { status: 204 });
  }

  if (id && m === "DELETE") {
    await env.DB.prepare("DELETE FROM plants WHERE id = ?").bind(id).run();
    return new Response(null, { status: 204 });
  }

  return json({ error: "method not allowed" }, 405);
}

// ---------- iPhone "log a call" Shortcut ----------
// The Shortcut can't hold a cookie, so it sends a key instead:
// "Authorization: Bearer <key>". The key is made in the signed-in app
// (POST /api/shortcut-key), shown once, and only its SHA-256 hash is stored.
// Making a new key kills the old one. Keys are 256-bit random, so guessing
// is not a concern and these routes skip the login lockout.

// Days between talks by closeness: your saved config, else public/setup.js, else these.
const DEFAULT_DAYS = { 1: 60, 2: 30, 3: 14, 4: 7, 5: 3 };

async function shortcutRoute(request, env, url) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE name = 'shortcut_key_hash'").first();
  const given = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!row || !given || !(await sameSecret(await sha256Hex(given), row.value))) {
    return text("Garden key missing or wrong. Make a new one in the Garden app.", 401);
  }

  const plants = await loadPlants(env);
  const labelled = labelPlants(plants);
  const IDEAL_DAYS = (await loadConfig(env)).idealDays;

  if (url.pathname === "/api/shortcut/people" && request.method === "GET") {
    // Plain text, one name per line, most overdue first: Shortcuts splits
    // it by new lines and keeps the order in "Choose from List".
    const now = Date.now();
    const overdue = (p) => {
      const last = Date.parse(p.lastContactDate || p.createdAt || 0) || 0;
      return (now - last) / 86_400_000 / (IDEAL_DAYS[p.level] || IDEAL_DAYS[3]);
    };
    labelled.sort((a, b) => overdue(b.plant) - overdue(a.plant));
    return text(labelled.map((l) => l.label).join("\n"));
  }

  if (url.pathname === "/api/shortcut/log" && request.method === "POST") {
    const body = await readBody(request);
    const name = body && typeof body.name === "string" ? body.name.trim() : "";
    const hit = labelled.find((l) => l.label === name);
    if (!hit) return text("Couldn't find " + (name || "that person") + " in the garden.", 404);

    const p = hit.plant;
    const now = new Date().toISOString();
    const convo = {
      id: Math.random().toString(36).slice(2) + Date.now().toString(36),
      date: now, topic: null, durationMinutes: null, method: "Phone", setting: "1v1",
    };
    const data = { ...p, conversations: (p.conversations || []).concat([convo]), lastContactDate: now };
    delete data.id;
    await env.DB.prepare("UPDATE plants SET data = ?, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify(data), now, p.id).run();
    return text("Watered " + hit.label + ".");
  }

  return text("Not found.", 404);
}

// ---------- groups, places and rhythm ----------
const SCENES = { groups: ["friends", "family", "professional", "plain"], locations: ["coast", "city", "forest", "plain"] };

function cleanConfig(input) {
  const out = {};
  for (const kind of ["groups", "locations"]) {
    const list = Array.isArray(input?.[kind]) ? input[kind] : [];
    const seen = new Set();
    out[kind] = list.map((t) => ({
      name: typeof t?.name === "string" ? t.name.trim().replace(/\s+/g, " ").slice(0, 24) : "",
      scene: SCENES[kind].includes(t?.scene) ? t.scene : "plain",
    })).filter((t) => t.name && t.name !== "Other" && !seen.has(t.name) && seen.add(t.name)).slice(0, 12);
    if (!out[kind].length) return null;
  }
  out.idealDays = {};
  for (let k = 1; k <= 5; k++) {
    const n = Math.round(Number(input?.idealDays?.[k]));
    if (!(n >= 1 && n <= 365)) return null;
    out.idealDays[k] = n;
  }
  return out;
}

async function loadConfig(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE name = 'garden_config'").first();
  const setup = globalThis.GARDEN_SETUP || {};
  const saved = row ? JSON.parse(row.value) : {};
  return { groups: saved.groups || setup.groups || [], locations: saved.locations || setup.locations || [],
    idealDays: saved.idealDays || setup.idealDays || DEFAULT_DAYS };
}

async function configRoute(request, env) {
  if (request.method === "GET") {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE name = 'garden_config'").first();
    return json(row ? JSON.parse(row.value) : null); // null = use public/setup.js
  }
  if (request.method === "PUT") {
    const cfg = cleanConfig(await readBody(request));
    if (!cfg) return json({ error: "Each list needs at least one name, and days must be 1 to 365." }, 400);
    await env.DB.prepare("INSERT OR REPLACE INTO settings (name, value) VALUES ('garden_config', ?)").bind(JSON.stringify(cfg)).run();
    return json(cfg);
  }
  return json({ error: "method not allowed" }, 405);
}

async function shortcutKeyRoute(request, env) {
  if (request.method === "GET") {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE name = 'shortcut_key_made'").first();
    return json({ madeAt: row ? row.value : null });
  }
  if (request.method === "POST") {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const key = "gk_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("INSERT OR REPLACE INTO settings (name, value) VALUES ('shortcut_key_hash', ?)").bind(await sha256Hex(key)),
      env.DB.prepare("INSERT OR REPLACE INTO settings (name, value) VALUES ('shortcut_key_made', ?)").bind(now),
    ]);
    return json({ key, madeAt: now });
  }
  return json({ error: "method not allowed" }, 405);
}

async function loadPlants(env) {
  const { results } = await env.DB.prepare("SELECT id, data FROM plants").all();
  return results.map((r) => ({ ...JSON.parse(r.data), id: r.id }));
}

// A plant's name as shown in the Shortcut's list. Same-named people get a
// suffix (location, then a number) so every label points at one plant.
function labelPlants(plants) {
  const sorted = plants.slice().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const used = new Set();
  return sorted.map((p) => {
    const base = String(p.name || "").trim().replace(/\s+/g, " ") || "Unnamed";
    let label = base;
    if (used.has(label) && p.location) label = base + " (" + p.location + ")";
    for (let n = 2; used.has(label); n++) label = base + " (" + n + ")";
    used.add(label);
    return { label, plant: p };
  });
}

async function sha256Hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

function text(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// ---------- login ----------

async function login(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const now = Date.now();
  const ipSince = new Date(now - IP_WINDOW_MIN * 60_000).toISOString();
  const allSince = new Date(now - GLOBAL_WINDOW_MIN * 60_000).toISOString();
  const counts = await env.DB.prepare(
    "SELECT (SELECT count(*) FROM login_failures WHERE ip = ? AND at > ?) AS ip_n, " +
    "(SELECT count(*) FROM login_failures WHERE at > ?) AS all_n"
  ).bind(ip, ipSince, allSince).first();
  if (counts.ip_n >= IP_LIMIT || counts.all_n >= GLOBAL_LIMIT) {
    return json({ error: "locked", message: "Too many wrong tries. Wait 15 minutes, then try again." }, 429);
  }

  const body = await readBody(request);
  const given = body && typeof body.passcode === "string" ? body.passcode : "";
  if (!(await sameSecret(given, env.GARDEN_PASSCODE))) {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO login_failures (ip, at) VALUES (?, ?)").bind(ip, new Date(now).toISOString()),
      env.DB.prepare("DELETE FROM login_failures WHERE at < ?").bind(new Date(now - 86_400_000).toISOString()),
    ]);
    const left = IP_LIMIT - counts.ip_n - 1;
    return json({ error: "wrong", message: left > 0 ? "Wrong passcode." : "Wrong passcode. Locked for 15 minutes." }, 401);
  }

  const exp = Math.floor(now / 1000) + SESSION_DAYS * 86400;
  const token = exp + "." + (await sign(String(exp), env));
  return new Response(null, {
    status: 204,
    headers: {
      "Set-Cookie": `${COOKIE}=${token}; Max-Age=${SESSION_DAYS * 86400}; Path=/; HttpOnly; Secure; SameSite=Strict`,
      "Cache-Control": "no-store",
    },
  });
}

function logout() {
  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict` },
  });
}

async function validSession(request, env) {
  const raw = (request.headers.get("Cookie") || "").split(/;\s*/).find((c) => c.startsWith(COOKIE + "="));
  if (!raw) return false;
  const [exp, sig] = raw.slice(COOKIE.length + 1).split(".");
  if (!/^\d+$/.test(exp || "") || !sig) return false;
  if (Number(exp) < Date.now() / 1000) return false;
  return sameSecret(sig, await sign(exp, env));
}

// HMAC key = session secret + passcode, so a new passcode voids old cookies.
async function sign(message, env) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(env.SESSION_SECRET + "\u0000" + env.GARDEN_PASSCODE),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(mac))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Compares hashes of both strings so timing reveals nothing about the secret.
async function sameSecret(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// ---------- helpers ----------

async function readBody(request) {
  const text = await request.text();
  if (!text || text.length > MAX_BODY) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
