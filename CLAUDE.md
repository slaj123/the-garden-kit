# The Garden: notes for Claude Code

Contacts as plants: one Cloudflare Worker (`src/worker.js`) serving a single-file page (`public/index.html`) and a small API over D1. See README.md.

## If the person wants to set it up

Run the `/setup` command (`.claude/commands/setup.md`): interview them, write `setup.json`, run `npm run setup -- --apply`, then walk them through deploying. Assume they may never have used a terminal. Explain each step in one line before running it.

## Where personal choices live

- `public/setup.js` (written from `setup.json`): starting relationship groups, places, and days-between-talks per closeness level. It's committed, so keep it to group and place names, never people.
- In-app **Groups & places** (bottom of the page): saved in D1 `settings` as `garden_config`, and it wins over `public/setup.js`. The Worker uses the same days for the Shortcut's most-overdue ordering.
- Scenes: groups use `friends | family | professional | plain`; places use `coast | city | forest | plain`. Adding a new scene means new CSS, a background in the biome map, and a plant species in `index.html`.
- Contacts live only in D1. Never write people's names, numbers or exports into the repo. Use a git-ignored `private/` folder for exports.
- Secrets: `GARDEN_PASSCODE`, `SESSION_SECRET` (`wrangler secret put` online, `.dev.vars` locally). Don't echo them in chat.

## Checks before calling anything done

- `node --check src/worker.js`.
- `npm run dev`, log in with the passcode in `.dev.vars`, add a plant, log a conversation, and open Groups & places.
