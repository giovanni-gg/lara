# Lara

A language-learning web app for the phone. Three things:

1. **Flashcards** on a real spaced-repetition scheduler (FSRS-6, the algorithm behind Anki's modern scheduler).
2. **Prompt-to-deck** — describe what you want to learn and get cards, examples, and audio, without touching a computer.
3. **Listen & Read**: stories written one CEFR level above you, from one of your decks or from everything you've studied, plus a controlled handful of new words. Each one is read aloud sentence by sentence, and you tap any sentence to hear it again and see its translation.
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
| `ANTHROPIC_API_KEY` | Deck and story generation; the card tutor | Those return a clear 503; studying and manual cards still work |
| `ELEVENLABS_API_KEY` | Audio on cards and stories | Content is created silently, no audio |

Voice IDs for Swedish and Brazilian Portuguese carried over from `anki_creator`
and live in `src/lib/languages.ts`.

---

## Testing

Two layers, neither of which needs your `prisma dev` database, a key, or the
network (beyond the first `npm install`):

```bash
npm test               # unit: pure functions, colocated src/**/*.test.ts (~1 s)
npm run test:int       # integration: real Postgres, real Prisma, real actions (~20 s)
npm run typecheck      # prisma generate + tsc --noEmit, test files included
```

- Each integration run starts its **own throwaway PostgreSQL 17**
  (`embedded-postgres`) on a free loopback port, applies every migration with
  `prisma migrate deploy`, and deletes it afterwards. It refuses any database
  address that isn't `127.0.0.1`/`localhost`, so they can't reach Neon.
- Nothing calls Anthropic, ElevenLabs or Blob: the suites blank those keys, so
  the app takes its "not configured" paths (AI routes answer 503).
- There are no browser tests, by choice.
- CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit and integration
  in one job on every push and PR.

How to add tests, the factories and the fixture world: [`tests/README.md`](tests/README.md).

---

## Importing from Anki

Bring a whole Anki profile over — decks and subdecks, cards, audio and images,
scheduling state, and the full review history:

```bash
# See what would be imported; writes nothing.
npm run import:anki-collection -- "$APPDATA/Anki2/User 1/collection.anki2" sv --dry-run

# Import. --replace deletes the profile's existing decks first.
npm run import:anki-collection -- "$APPDATA/Anki2/User 1/collection.anki2" sv --replace
```

- Anki is never written to: the collection is copied and opened read-only, so
  it's fine to run with Anki open.
- Cards keep the side Anki showed first: audio on the front → Swedish first,
  audio on the back → English first, a picture on the front → picture card.
- FSRS stability/difficulty come straight from Anki. Cards reviewed before FSRS
  was switched on get theirs by replaying their history.
- Suspended cards stay suspended; daily limits are copied from the deck preset.
- Then run `npm run media:optimize`: Anki pictures are 1024px PNGs (~850 KB);
  this writes 640px WebPs (~20 KB) and points the cards at them.
- Re-running with `--replace` refuses if you've done reviews in Lara since
  (they'd be lost); add `--force` if that's really what you want.

The older CSV importer for `anki_creator` output still exists
(`npm run import:anki -- <dir> sv`).

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
prisma/schema.prisma        Users, language profiles, decks, cards, reviews, stories (Article)
src/lib/
  srs.ts                   FSRS wrapper — the only file that imports ts-fsrs; scheduler settings
  deck-tree.ts             Deck/subdeck tree with rolled-up counts
  study.ts                 Queue building, review submission, deck/profile stats
  ai/cards.ts              Prompt → flashcards
  ai/stories.ts            Deck words + prompt + length → a story at i+1, split by sentence
  stories.ts               Gathers the vocabulary, saves the story, speaks its sentences
  ai/tutor.ts              The per-card tutor (streaming)
  tutor-prompts.ts         Suggested questions; client-safe, no AI SDK import
  tts.ts                   ElevenLabs, content-hash cached
  media.ts                 Local file storage; swap for Blob in production
  session.ts               Current user — the single seam real auth goes through
src/app/
  page.tsx                 Today: counts, study button, prompt-to-deck
  study/                   The review session, with the card tutor sheet
  decks/                   Deck list, deck detail, manual card entry
  articles/                Listen & Read: story library, new-story form, reader
  api/                     reviews, */generate, cards/[id]/chat, segments audio
scripts/import-anki.ts     Anki collection importer CLI (decks, cards, media, history)
scripts/anki/              The import itself (import.ts) and its pure field parsing (parse.ts)
scripts/import-anki-csv.ts anki_creator CSV importer
```

---

## Deploying

Built to go to Vercel with Neon, though nothing is deployed yet:

- `prisma generate` runs as part of `npm run build`.
- Migrations reach production only through `npm run db:migrate:deploy`
  (`npm run db:migrate:status:prod` to check first, read-only). Those scripts,
  any other `*:prod` script, or `PRISMA_TARGET=production` make
  `prisma.config.ts` read the Neon URLs from `.env.neon-prod` (gitignored,
  preferring `DATABASE_URL_UNPOOLED`); every other Prisma command targets the
  local `prisma dev` database in `.env`.
- Prisma talks to Postgres through `@prisma/adapter-pg` over plain TCP, so
  moving to Neon is a `DATABASE_URL` change and nothing else.
- Generation routes set `maxDuration = 300` and run on the Node.js runtime
  (they need `node:crypto` and `node:fs`), which is the Fluid Compute default.

Two things must change before this is a real deployment:

- **Auth.** Everything currently resolves to one local account via
  `src/lib/session.ts`. That file is the only place that knows who the user is.
- **Media storage.** Set `MEDIA_STORAGE=blob` in production and upload
  `.media/` once — see below. The default, `local`, writes to disk, which is
  not durable on serverless.

### Media on Vercel Blob

Card audio and images are always addressed as `/api/media/<key>.<ext>`, and
those URLs are stored in the database, so they don't change between backends.
`MEDIA_STORAGE` (read by `src/lib/media.ts`) picks where the bytes live:

- `local` (default): `.media/` on disk. Development only.
- `blob`: a **private** Vercel Blob store, at pathname `media/<key>.<ext>`.
  `/api/media` streams each object through server-side, so media stays behind
  the app's password rather than on public Blob URLs. New TTS audio is
  written there too. Credentials are whatever the connected store provides:
  `BLOB_READ_WRITE_TOKEN`, or OIDC (`VERCEL_OIDC_TOKEN` + `BLOB_STORE_ID`).

One-time setup:

```bash
# 1. Create a private Blob store, connect it to the project (Storage tab),
#    and set MEDIA_STORAGE=blob for Production.
vercel blob create-store lara-media --access private
# 2. Pull the production env, which includes the store's credentials:
vercel env pull .env.production.local --environment=production
# 3. Count what would be uploaded, then upload:
npm run media:upload -- --env-file .env.production.local --dry-run
npm run media:upload -- --env-file .env.production.local
```

The upload lists the store once, skips files already there at the same size,
and runs 8 uploads at a time with retries. It's safe to interrupt (Ctrl-C lets
in-flight uploads finish) and re-run: it resumes where it stopped. Run it again
after importing more Anki media locally.
