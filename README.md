# opo — Personal Opportunity Agent

A personal agent that finds jobs, internships, fellowships, scholarships, research positions, and hackathons tailored to one person's profile, explains why each one fits, prepares the application, and lets the user approve before anything is sent.

**Apply model: draft-then-approve.** The agent never submits anything on its own.

---

## Key Features

1. **Strict Matching Engine**:
   - **Hard Rejects First**: Title/description matches user's excluded keywords, or misses 100% of required skills.
   - **Skills are ~80% of the score**: Focuses on genuine capability fit.
   - **Opportunity Type is Neutral**: Opportunity types (fellowship, job, internship, etc.) are informational only and never penalize the match score.
   - **Unpaid Opportunities Welcomed**: Unpaid listings (`unpaid: true`) score 1.0 compensation fit by default unless the user explicitly configured a required minimum.
   - **Location Mismatches are Soft**: Highlights relocation needs without hard-filtering high skills fit; flags unknown locations rather than guessing.
   - **Application Fee Trust Signal**: Discounts score (~0.6x), marks `payment_required`, and surfaces prominent verification warnings.
   - **Reasons & Flags**: Human-readable checkmarks (`✓`/`✗`) per requirement and explicit flags for ambiguous items.

2. **Draft-Then-Approve Vault**:
   - Persistent application lifecycle state machine:
     `discovered` → `shortlisted` → `drafting` → `needs_input` → `ready` → `submitted` → outcomes (`interview`/`offer`/`rejected`).
   - "Things you don't know" pings surface unusual requirements (nomination letters, portfolios, video introductions) before moving to `ready`.
   - In-place application draft editing and official site application links.

3. **Zero-Knowledge & Privacy**:
   - **Local-Only Data**: Profile, preferences, drafts, and answer library are stored strictly in the user's browser (`localStorage` / `IndexedDB`).
   - **Direct Groq Connection**: User's Groq API key is kept exclusively in browser storage; requests go directly to Groq's CORS-enabled endpoint (`https://api.groq.com/openai/v1/chat/completions`) and never touch an intermediary developer server.

4. **Discovery Feeds**:
   - Live verified public sources: **Remotive API** + **Arbeitnow Public API** (with stateless serverless `/api/proxy` fallback for CORS-restricted networks).
   - Test fixtures are isolated in `tests/fixtures/` and never leaked into live user daily reports.

---

## Design System & Aesthetics

- **Color Palette**: Muted dusty sage (`#819288`), warm greige surfaces (`#f8f7f4`, `#ffffff`), soft clay (`#c7b9ab`), and dark charcoal ink (`#222825`, no pure black).
- **Typography**: Editorial serif headings (`'Newsreader'`) paired with clean humanist sans (`'Plus Jakarta Sans'`).
- **Tactile UI**: Generous whitespace, soft rounded corners, score badges, status pills, and responsive mobile PWA navigation.

---

## Getting Started

### Development
```bash
# Install dependencies
npm install

# Start local dev server (http://localhost:5173)
npm run dev
```

### Automated Tests (Vitest)
```bash
# Run all automated test suites
npm test
```

### Production Build
```bash
# Build production bundle
npm run build

# Preview build locally
npm run preview
```

---

## Future Roadmap: Dedicated Fellowship & Scholarship Ingestion
Because no free, turnkey, open public REST APIs exist specifically for international fellowships and scholarships, the next phase will introduce:
- An ATS-native crawler (Greenhouse, Lever, Workday) for university research labs and academic fellowships.
- An RSS feed ingestor for academic and foundation grant bulletins (EURAXESS, government portals).
