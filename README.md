# Lead Finder — FOMO Global Marketing / Echoooo

A small internal tool for the sales team:
1. Search companies by country + business type (F&B / Retail / FMCG) + employee size
2. Pull the marketing/influencer decision-maker at each one (via Lusha)
3. Each rep writes their own WhatsApp message template (saved on their own device)
4. One click opens WhatsApp with the message pre-filled, ready to send

## How it actually works (read this first)

- **One shared Lusha API key** lives on the server, never in the browser. Every
  rep uses the same tool but nobody sees or needs their own key.
- **WhatsApp is not "connected."** There is no official way for a website to
  silently send WhatsApp messages from a personal account. Instead, the "Send
  WhatsApp" button opens `wa.me` with the message pre-typed in whichever
  WhatsApp (app or web) each rep is logged into on their own device — they
  still tap Send themselves. This is the same trick every legit outreach
  tool uses; anything that claims to "auto-send" from a personal WhatsApp
  number is violating WhatsApp's terms and risks the number getting banned.
- **Each rep's message template is local to their browser** (saved via
  `localStorage`), not shared across the team or stored on the server.

## Before you go live — verify the Lusha request shapes

I built `server.js` against the request/response shapes described in Lusha's
public docs (`docs.lusha.com`), but Lusha's prospecting filter field names
have changed between API versions before. **Before rolling this out to the
team:**

1. Log into the Lusha dashboard → API Hub → open the Postman/API playground.
2. Test `POST /prospecting/company/search`, `POST /v3/contacts/decision-makers`,
   and `POST /v3/contacts/enrich` there with a real query.
3. Compare the request body Postman sends against the ones in `server.js`
   (search for the `body = {...}` blocks) and adjust field names if they
   don't match — Lusha's playground will show you the exact working shape.
4. Also confirm the accepted `sizes` format for company search (the code
   currently sends `{min, max}` — some Lusha versions expect preset bucket
   strings instead, e.g. `"51-200"`).

This is the one part I couldn't verify without live API access, so treat the
Lusha integration as a working first draft, not guaranteed-correct.

## Setup

```bash
npm install
cp .env.example .env
# edit .env and paste your Lusha API key
npm start
```

Visit `http://localhost:3000`.

## Deploying so the team can use it

Any Node host works. Easiest options:

**Render.com (free tier is fine to start)**
1. Push this folder to a GitHub repo.
2. Render → New → Web Service → connect the repo.
3. Build command: `npm install` — Start command: `npm start`.
4. Add environment variable `LUSHA_API_KEY` in Render's dashboard.
5. Render gives you a URL like `fomo-leadgen.onrender.com` — share that with the team.

**Railway.app** — same idea, slightly faster free tier setup.

Either way: the Lusha key only ever lives in the host's environment
variables, never in the code you push to GitHub (`.env` is already excluded
via `.env.example` being the only committed one — make sure you add a
`.gitignore` with `.env` and `node_modules` before pushing).

## Notes / next steps you may want later

- Add a login so you can see which rep is using the tool (currently anyone
  with the link can use it — fine for a small trusted team, less fine at scale).
- Add a shared "sent log" so reps don't double-message the same contact.
- Swap the employee-size dropdown for whatever exact bucket values Lusha's
  Company Filters endpoint returns for your plan.
