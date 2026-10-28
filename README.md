# The Garden

A personal contact tracker where every person you want to stay close to is a plant. Plants stay healthy when you keep in touch and start to wilt when it's been too long. It installs to your phone's home screen like an app.

This is a **setup kit**: the full app, with no data in it. You deploy your own copy, so your contacts live only in your own database.

- **One plant per person.** Each has a closeness level from 1 to 5, which sets how often you'd like to talk: every 60, 30, 14, 7 or 3 days.
- **Two ways to see your garden.** Group by relationship (Friends, Family, Professional, Other) or by location (Coast, City, Forest, Other). Each location has its own scenery and plant species. You can add your own tags.
- **Log conversations.** Record when and how you talked, and the plant perks up.
- **iPhone Shortcut.** An optional "Log a call" Shortcut lists people most-overdue first and logs a call in two taps.
- **Locked.** One passcode protects the whole app. A correct passcode signs the device in for a year. Five wrong tries from one IP locks that IP out for 15 minutes.

Built as one Cloudflare Worker that serves the page plus a small API, with a D1 (SQLite) database. It runs on Cloudflare's free plan.

## What you need

- [Node.js](https://nodejs.org) 20 or newer
- A free [Cloudflare](https://dash.cloudflare.com/sign-up) account

## 1. Install

```bash
git clone https://github.com/<your-username>/the-garden-kit.git
cd the-garden-kit
npm install
```

## 2. Run it locally

Create a file named `.dev.vars` in the project folder (it is git-ignored):

```
GARDEN_PASSCODE=local-test-passcode
SESSION_SECRET=any-random-string-at-least-32-characters-long
```

Create the local database and start the app:

```bash
npx wrangler d1 migrations apply the-garden --local
npm run dev
```

Open http://localhost:8787, enter your local passcode, and plant someone.

## 3. Put it online

1. Log in to Cloudflare from the terminal:
   ```bash
   npx wrangler login
   ```
2. Create the database:
   ```bash
   npx wrangler d1 create the-garden
   ```
   Copy the `database_id` it prints into `wrangler.jsonc`, replacing `REPLACE_WITH_D1_DATABASE_ID`.
3. Create the tables:
   ```bash
   npx wrangler d1 migrations apply the-garden --remote
   ```
4. Set the two secrets. Each command asks you to paste a value:
   ```bash
   npx wrangler secret put GARDEN_PASSCODE
   npx wrangler secret put SESSION_SECRET
   ```
   The passcode must be at least 12 characters. `SESSION_SECRET` must be 32 or more random characters. To generate one:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```
5. Deploy:
   ```bash
   npm run deploy
   ```
   It prints your URL, something like `https://the-garden.<your-subdomain>.workers.dev`.

If either secret is missing, the app refuses every request instead of running unlocked.

## 4. Add it to your phone

On iPhone, open the URL in Safari, tap **Share**, then **Add to Home Screen**. Enter the passcode once.

## Optional: "Log a call" iPhone Shortcut

iOS doesn't let Shortcuts read your call history, so this Shortcut asks who you talked to.

1. In the app, open the footer and tap **iPhone call shortcut**. Copy the key it shows (it starts with `gk_`). It is shown only once, and only a hash of it is stored. Making a new key turns off the old one.
2. In the Shortcuts app, create a new Shortcut with these actions:
   1. **Get Contents of URL**: `https://<your-app-url>/api/shortcut/people`, method GET, with the header `Authorization` set to `Bearer gk_...` (your key).
   2. **Split Text** by New Lines.
   3. **Choose from List** (the list is sorted most-overdue first).
   4. **Get Contents of URL**: `https://<your-app-url>/api/shortcut/log`, method POST, same `Authorization` header, request body JSON with a field `name` set to the Chosen Item.
   5. **Show Result** (optional), which confirms who was logged.
3. Optionally, add an automation that runs it when a call ends, or put it on your home screen.

## Changing things later

- **Your own locations or groups:** edit `REL_SEED` and `LOC_SEED` near the top of the script in `public/index.html`. New tags get a plain green garden and a generic shrub. To give one its own scenery, add it to `LOC_BIOME_CLASS` and `LOC_SPECIES`.
- **Contact rhythm:** the days per closeness level are in `IDEAL_DAYS`, in both `public/index.html` and `src/worker.js`. Keep the two the same.
- **New icons:** `npm run icons` redraws them.
- **Database changes:** add a file in `migrations/`, then run `npx wrangler d1 migrations apply the-garden --remote`.
- **Change the passcode:** run `npx wrangler secret put GARDEN_PASSCODE`. This signs out every device.

## Privacy

Your data never leaves your own Cloudflare account. Don't commit `.dev.vars` or any exports of your contacts. Keep exports in a git-ignored folder such as `private/`.

## License

MIT. See `LICENSE`.
