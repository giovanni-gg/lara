# Lara

A language-learning web app for the phone. Three things:

1. **Flashcards** on a real spaced-repetition scheduler (FSRS-6, the algorithm behind Anki's modern scheduler).
2. **Prompt-to-deck** — describe what you want to learn and get cards, examples, and audio, without touching a computer.
3. **Immersion reading** — stories and articles written one CEFR level above you, built out of words you already know plus a controlled handful of new ones.
4. **A tutor on every card** — ask about a conjugation, a word order, a false friend, mid-review, without leaving the session. Threads persist per card.

It grew out of [`anki_creator`](../personal-projects/anki_creator), a Python script that generated Anki CSVs. This replaces the whole loop: no CSV, no import step, no desktop.

---

## Running it

```bash
npm install

# 1. Start the local Postgres (real Postgres, no Docker needed).
#    Copy the two URLs it prints into .env as DATABASE_URL and SHADOW_DATABASE_URL.
npm run db:dev

# 2. In another terminal:
npm run db:migrate
npm run dev
```

Open http://localhost:3000. On first run you pick a language and level.

To use it on your phone while developing, find your machine's LAN IP and open
`http://<your-ip>:3000` — then **Share → Add to Home Screen** in Safari. It
installs as a standalone app (manifest + `viewport-fit=cover`, so it goes
full-bleed under the notch).

### Keys

Nothing is required to run the app, but the interesting parts need credentials:

| Variable | Unlocks | Without it |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Deck, story, and article generation; the card tutor | Those return a clear 503; studying and manual cards still work |
| `ELEVENLABS_API_KEY` | Audio on cards, stories, and articles | Content is created silently, no audio |

Voice IDs for Swedish and Brazilian Portuguese carried over from `anki_creator`
and live in `src/lib/languages.ts`.

---

## Importing your existing decks

```bash
npm run import:anki -- "../personal-projects/anki_creator/input/language_learning/target_swedish" sv
```

Directory structure becomes deck names (`nouns/professions.csv` → "Nouns ·
Professions"). Re-running is safe — existing cards are skipped, not duplicated.
Audio isn't regenerated on import; imported cards get it when you next edit them
or generate alongside them.

---

## About the scheduling algorithm

Two separate things, which is what makes this workable:

- **Anki** itself is AGPL-3. Using its code would put the same licence on this app.
- **FSRS** (Free Spaced Repetition Scheduler) — the algorithm Anki has shipped
  as its scheduler since 2023 — is published independently and permissively
  licensed. `ts-fsrs`, the TypeScript implementation this app uses, is MIT.

So we get the real algorithm with none of the licence entanglement, and none of
Anki's code. `src/lib/srs.ts` is the only file that knows FSRS exists.

Two properties worth knowing, because they shape the schema:

- Every answer is written to an immutable `Review` row. FSRS parameters can be
  re-optimised against your own review history later — but only if the full
  history was kept from day one.
- Reviews and new cards have **independent** daily caps, as in Anki. A review
  backlog doesn't starve new material.

---

## Layout

```
prisma/schema.prisma        Users, language profiles, decks, cards, reviews, articles
src/lib/
  srs.ts                   FSRS wrapper — the only file that imports ts-fsrs
  study.ts                 Queue building, review submission, deck/profile stats
  ai/cards.ts              Prompt → flashcards
  ai/stories.ts            Prompt + length → narrative fiction at i+1
  ai/articles.ts           Topic → level-appropriate article, split by sentence
  ai/tutor.ts              The per-card tutor (streaming)
  tutor-prompts.ts         Suggested questions; client-safe, no AI SDK import
  tts.ts                   ElevenLabs, content-hash cached
  media.ts                 Local file storage; swap for Blob in production
  session.ts               Current user — the single seam real auth goes through
src/app/
  page.tsx                 Today: counts, study button, prompt-to-deck
  study/                   The review session, with the card tutor sheet
  decks/                   Deck list, deck detail, manual card entry
  articles/                Stories + articles library and reader
  api/                     reviews, */generate, cards/[id]/chat, segments audio
scripts/import-anki-csv.ts anki_creator CSV importer
```

---

## Deploying

Built to go to Vercel with Neon, though nothing is deployed yet:

- `prisma generate` runs as part of `npm run build`.
- Prisma talks to Postgres through `@prisma/adapter-pg` over plain TCP, so
  moving to Neon is a `DATABASE_URL` change and nothing else.
- Generation routes set `maxDuration = 300` and run on the Node.js runtime
  (they need `node:crypto` and `node:fs`), which is the Fluid Compute default.

Two things must change before this is a real deployment:

- **Auth.** Everything currently resolves to one local account via
  `src/lib/session.ts`. That file is the only place that knows who the user is.
- **Media storage.** `src/lib/media.ts` writes to disk, which is not durable on
  serverless — switch it to Vercel Blob.
