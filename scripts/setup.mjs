// npm run setup: choose how your garden is grouped and how often you want to talk to people.
// Writes setup.json (your answers, git-ignored) and public/setup.js (what the app starts from).
// `npm run setup -- --apply` skips the questions and applies setup.json as-is.
import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { APPLY_ONLY, loadSetup, saveSetup, ask, askList, askNumber, askYesNo, done, wrangler } from "./lib/setup-kit.mjs";
import "../public/setup.js";

const SCENES = {
  groups: { friends: "Wildflower meadow", family: "Orchard", professional: "Formal garden", plain: "Plain garden" },
  locations: { coast: "Coast", city: "Rooftop", forest: "Forest", plain: "Plain garden" },
};
const LEVELS = { 1: "Sprout (loosest)", 2: "Succulent", 3: "Fern", 4: "Blossom", 5: "Rose (closest)" };

const s = loadSetup("setup.json", { ...globalThis.GARDEN_SETUP, localDev: true });

async function askBeds(kind, question) {
  const names = await askList(question, s[kind].map((t) => t.name));
  const keys = Object.keys(SCENES[kind]);
  const out = [];
  for (const name of names) {
    const current = s[kind].find((t) => t.name === name)?.scene || "plain";
    const menu = keys.map((k, i) => `${i + 1}=${SCENES[kind][k]}`).join(", ");
    const n = await askNumber(`  Scenery for "${name}" (${menu})`, keys.indexOf(current) + 1, { min: 1, max: keys.length });
    out.push({ name, scene: keys[n - 1] });
  }
  return out;
}

if (!APPLY_ONLY) {
  console.log("The Garden setup. Press Enter to keep the value in [brackets]. \"Other\" is always added for you.\n");
  s.groups = await askBeds("groups", "How do you group the people in your life");
  s.locations = await askBeds("locations", "Places your people live");
  if (await askYesNo("Change how often you want to talk to people at each closeness level?", false)) {
    for (const k of [1, 2, 3, 4, 5]) s.idealDays[k] = await askNumber(`  Days between talks for ${LEVELS[k]}`, s.idealDays[k], { min: 1, max: 365 });
  }
  s.localDev = await askYesNo("Set up local testing now (random local passcode + local database)?", s.localDev);
  saveSetup("setup.json", s);
}
done();

if (!s.groups.length || !s.locations.length) {
  console.error("Setup needs at least one group and one place.");
  process.exit(1);
}
const { localDev, ...cfg } = s;
writeFileSync("public/setup.js",
  "// Your starting groups, places and contact rhythm. Written by `npm run setup` (or Claude Code's /setup).\n" +
  "// Changes made in the app (\"Groups & places\" at the bottom of the page) are saved on the server and win over this file.\n" +
  "// Scenes: groups use friends | family | professional | plain; places use coast | city | forest | plain.\n" +
  `globalThis.GARDEN_SETUP = ${JSON.stringify(cfg, null, 2)};\n`);
console.log("Wrote public/setup.js.");

if (localDev) {
  if (!existsSync(".dev.vars")) {
    const passcode = randomBytes(12).toString("base64url");
    writeFileSync(".dev.vars", `GARDEN_PASSCODE=${passcode}\nSESSION_SECRET=${randomBytes(32).toString("base64url")}\n`);
    console.log(`Wrote .dev.vars (git-ignored). Your LOCAL passcode is: ${passcode}`);
  }
  wrangler("d1", "migrations", "apply", "the-garden", "--local");
  console.log("\nLocal garden ready. Run `npm run dev` and open http://localhost:8787.");
}
console.log("To put it online, follow \"Put it online\" in README.md (or ask Claude Code: /setup).");
console.log("You can change groups, places and rhythm any time in the app: \"Groups & places\" at the bottom.");
