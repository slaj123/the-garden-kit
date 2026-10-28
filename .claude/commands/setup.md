---
description: Shape your garden (groups, places, rhythm), then put it online
---

Walk the person through setting up their own Garden. One step at a time, say what each step does in one plain sentence, and wait for them before moving on. Define technical words the first time.

1. **Check tools.** `node --version` (20 or newer). If `node_modules/` is missing, run `npm install`.

2. **Interview them**, one question at a time:
   - How they group the people in their life (e.g. Friends, Family, Work, Team). For each group, suggest a scenery: `friends` (wildflower meadow), `family` (orchard), `professional` (formal garden) or `plain`.
   - Where their people live (cities or regions). For each, suggest a scenery: `coast`, `city` (rooftop), `forest` or `plain`.
   - Whether the default rhythm suits them: days between talks for closeness levels 1 to 5 are 60, 30, 14, 7 and 3. Offer to change it.
   - Whether to set up local testing.

   "Other" is always added for both lists; don't include it.

3. **Write `setup.json`**: `{ "groups": [{ "name": "...", "scene": "..." }], "locations": [{ "name": "...", "scene": "..." }], "idealDays": { "1": 60, "2": 30, "3": 14, "4": 7, "5": 3 }, "localDev": true }`. Confirm it with them.

4. **Apply:** `npm run setup -- --apply`. It writes `public/setup.js`, and with local testing on, a random local passcode in `.dev.vars` plus a local database. Don't paste the passcode into chat.

5. **Try it:** `npm run dev`, open http://localhost:8787, log in, and plant someone. Show them **Groups & places** at the bottom of the page: they can change all of this later without redeploying.

6. **Put it online** (when they say go): `npx wrangler login`, then `npx wrangler d1 create the-garden` (you put the id into `wrangler.jsonc`), then `npx wrangler d1 migrations apply the-garden --remote`, then `npx wrangler secret put GARDEN_PASSCODE` and `npx wrangler secret put SESSION_SECRET` (they type the values; offer the random generator from README.md), then `npm run deploy`.

7. **Phone:** Safari, then Share, then Add to Home Screen. Mention the optional "Log a call" Shortcut in README.md.

End with three lines: what's live, where to change groups and places later, and how to redeploy.
