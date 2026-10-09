# opo — Personal Opportunity Agent

A personal agent that finds jobs, internships, fellowships, scholarships,
research positions, and hackathons that fit your profile — explains why
each one fits, prepares a draft application, and always waits for your
approval before anything is sent.

**Draft-then-approve, always.** opo never auto-submits an application.
It finds, scores, and prepares; you make the final call.

## What it does

- **Matching engine** — scores listings against your profile. Skills
  drive ~80% of the score. Employment type (full-time/part-time/
  internship/fellowship) never penalizes a match. Unpaid opportunities
  are welcomed by default. Application fees are flagged as a trust
  signal rather than an automatic rejection. Every result comes with
  plain-language reasons and flags — nothing is silently guessed.
- **Live discovery** — pulls real listings from the Remotive and
  Arbeitnow APIs, deduplicated across sources.
- **Groq-powered extraction & drafting** — uses your own Groq API key to
  extract structured skills from messy job descriptions and draft
  tailored cover letters.
- **Draft vault** — every prepared application persists through
  `shortlisted → drafting → needs_input → ready → submitted`, so nothing
  is a one-shot notification you lose track of.
- **"Things you don't know" pings** — surfaces anything a listing needs
  that isn't in your profile (a nomination letter, a portfolio link)
  instead of guessing or ignoring it.

## Privacy

- Your Groq API key and all your data (profile, drafts, application
  status) live only in your own browser's local storage.
- No accounts, no developer-controlled server, no cross-device sync.
- CV text, once uploaded, is parsed in-browser and sent directly to
  Groq's API — never to any server the developer controls.

## Tech

- Vite + vanilla JS PWA, installable to your home screen.
- Vitest for automated testing (matching engine, discovery/dedup logic).
- A serverless proxy (`api/proxy.js`) as a CORS fallback for discovery
  sources that block direct browser requests.


## Known gaps

- No dedicated fellowship/scholarship/research-specific source yet —
  Remotive and Arbeitnow are both general job boards. Worth adding a
  real source for this later; don't fabricate one.
- Local-only storage means no sync across devices for the same person —
  deliberate for now, revisit only if that becomes a real need.
