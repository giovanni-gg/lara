<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Lara

Language-learning app: FSRS flashcards, AI-generated decks, Listen & Read stories.
See `README.md` for what it is and how to run it.

## Non-obvious constraints

- **`src/lib/srs.ts` is the only file that imports `ts-fsrs`.** Everything else
  goes through `applyReview` / `previewIntervals`. Keeps the algorithm swappable
  and the FSRS↔Prisma enum mapping in one place.
- **`src/lib/session.ts` is the only file that knows who the user is.** Real auth
  replaces that file and nothing else. Don't read the user identity elsewhere.
- **Never run aggregate queries concurrently.** The local `prisma dev` Postgres
  rejects parallel `count`/`groupBy`/`aggregate` with `ConnectionClosed` (P1017)
  — sequentially they're fine, so this looks like a code bug and isn't. All three
  stats functions therefore use one `$queryRaw` with `count(*) FILTER (...)`
  instead. Don't "simplify" them back into `Promise.all` of ORM counts.
  Enum comparisons in that raw SQL need a cast: `c.state <> 'NEW'::"FsrsState"`.
- **Never write a per-deck stats loop either.** `deckStats` is for one deck; for a
  list use `statsByDeck`. 27 decks × 4 counts exhausts the 10-connection pool.
- **Restart `next dev` after `prisma generate` adds a model.** The dev server
  caches the old client module, and new accessors come back `undefined` with a
  confusing "Cannot read properties of undefined" rather than a clear error.
  Note `TaskStop`/Ctrl-C on the npm wrapper can leave the `next dev` child alive
  holding port 3000 — check the PID it reports and kill that.
- **`CardChat` needs `key={card.id}` at every call site.** It resets its thread by
  remounting; resetting via `useEffect` trips `react-hooks/set-state-in-effect`.
- **Stories are the only immersion content, stored in the `Article` model.**
  The name is historical: `/articles` is the Listen & Read section, and
  `Article.kind` is always `STORY` for new rows (`ARTICLE` stays in the enum
  only so old rows read). Don't add a parallel Story model or a second content
  type. The reader, segments, audio and save-word all hang off `Article`. A
  story built from a deck records it in `Article.deckId` and draws on that
  deck's subtree (`subtreeIds`, archived subdecks excluded).
- **AI card generation is a `CardJob`, run in `after()`.** `POST
  /api/decks/generate` queues it (202, at most 3 in progress per user, stale
  after 10 min → FAILED) and `src/lib/card-jobs.ts` does the model call,
  audio and pictures. A new deck is created only once the model names it. The
  floating pill (`card-jobs-pill.tsx`, root layout) polls `/api/card-jobs`
  every 2 s only while a job it has seen is in progress. Keep that endpoint
  to one indexed query; don't add a count or a join.
- **Story audio is per sentence; there's no whole-story clip.** The reader
  plays `ArticleSegment.audioUrl` clips back to back through `audio-cache`.
  A single clip of a medium or longer story would exceed `MAX_MEDIA_BYTES`
  (4 MB is about 4 minutes at 128 kbps). The generate route speaks the first
  3 sentences before it responds and the rest in `after()`. The reader
  synthesises any it reaches first via `/api/segments/[id]/audio`.
- **Daily limits are per deck, and only for new cards.** `Deck.newCardsPerDay`
  (default 5) caps how many new cards *that deck* introduces per study day
  (from 04:00, `startOfStudyDay`), counted as cards whose first-ever review is
  today. Reviews are never capped. "New" everywhere means `newToday` (today's
  remaining allowance), never the deck's total unseen cards. `buildQueue` and
  `statsByDeck` share one SQL fragment for this so the count and the session
  always agree; `sessionSize` is just `due + newToday`. The old
  `LanguageProfile.dailyNewLimit/dailyReviewLimit` columns are unused.
- **Archiving is `Deck.archivedAt`, applied to a whole subtree at once**
  (`archiveDeck` / `unarchiveDeck` / `moveDeck` keep that invariant), so
  queries only check the deck's own column. Archived decks are out of the
  queue, every count and the main tree; `loadDeckTree` returns them as
  `archivedRoots`. Don't model archiving as a deck named "Archive".
- **Every page is `dynamic = "force-dynamic"`** (set on the root layout). All of
  it is per-user; nothing is prerenderable.
- **Form-bound server actions must return `void`.** Throw on validation failure;
  returning `{ error }` from an `action={}` prop is a type error.
- **Stories are generated at `nextLevelUp(profile.level)`, not at the profile's
  level.** That i+1 gap is the point of the feature, not a bug.
- **Every account but the owner has daily AI caps** (100 cards, 5 stories per
  study day). The rule and the numbers live only in `src/lib/limits.ts`
  (`isUnlimited`: `LARA_OWNER_EMAIL`, else the default account); the counting
  in `src/lib/allowance.ts`. Cards are counted from `CardJob` rows (a running
  job holds its whole batch), never the Card table, so manual adds and Anki
  imports don't count and deleting cards doesn't refund them.
- **One shared password gates the whole app** (`src/proxy.ts` + `src/lib/auth.ts`,
  env `LARA_PASSWORD`). Public: `/login`, `/api/health`, `/_next/*`, favicon,
  manifest, root-level images. Unset locally → gate off; unset on Vercel → 503
  (fail closed). It doesn't identify anyone; `session.ts` still does that.
- **Prisma 7:** client is generated to `src/generated/prisma` (gitignored) and
  needs a driver adapter. `import { PrismaClient } from "@/generated/prisma/client"`,
  never from `@prisma/client`.
- **Speak's agent is generic; the learner arrives as overrides.** Prompt,
  first message, language and voice are built per session in
  `src/lib/speak/prompt.ts` and only apply because the agent allows them
  (`npm run speak:setup`). Change the agent there, never in the ElevenLabs
  dashboard, and re-run the script. Its primary language must not be English:
  the platform then insists on the English-only Flash v2 TTS.
- **The model is Claude Opus 5.5 (`src/lib/ai/model.ts`); every call uses
  `src/lib/ai/call.ts`.** It always thinks (depth via `effort`; cards and
  chips use `"low"`) and answers 400 to temperature/top_p/top_k, a thinking
  budget, forced tool choice and assistant prefill, so never pass those.
  Structured output must go through `structuredOutputMode: "outputFormat"`
  (`anthropicOptions()`): the fallback is a forced tool call. `loggedCall`
  logs one `[ai]` usage line per call and turns refusals and cut-offs into
  readable errors.
- **Adding cards to a deck shows the model the deck** (`loadDeckContext`:
  path, description, cards across the subtree), so new cards fit it. The
  deck page's chips come from `/api/decks/[deckId]/suggestions`, cached on
  `Deck.suggestions` and rewritten once the subtree's card count moves by 5.
- **TTS is content-hash cached** in `.media/`. Re-synthesising identical text is
  free, so don't add your own caching layer around it.
- **A card's facing is its own `cardType`, not the deck's.** RECOGNITION shows
  `target`, PRODUCTION shows `source`, PICTURE shows `imageUrl`. Decks only
  hold a default `direction` for new cards (BOTH = one card each way). On
  PRODUCTION/PICTURE never play or label the target before reveal — it's the
  answer.
- **Decks nest via `parentId`, like Anki's `Parent::Child`.** Counts and study
  sessions cover the whole subtree. Get them from `loadDeckTree` (one
  `statsByDeck` pass, aggregated in memory) and `subtreeIds` — never per-node
  queries. `DeckStats.learning` is learning cards *due now* (Anki's Learn
  column); Due = `due - learning`. A session over a subtree runs deck by deck
  in tree order (`src/lib/study-order.ts`), relearns rejoin their own deck's
  block, and `DeckTransition` pauses between decks.
- **Scheduler settings are fixed, not user settings.** `SCHEDULER_SETTINGS` in
  `srs.ts` mirrors the learner's Anki preset (85% retention, 10m steps, day
  starts 04:00, leech tag at 8 lapses). Keeping Settings small is the point;
  only daily limits and level are editable.
- **Anki import** (`scripts/import-anki.ts`) copies the collection and opens it
  read-only, so it's safe with Anki open. Anki day numbers are converted with
  the collection's *current* time zone; answers given in another zone can land
  a day off in the history check — that's expected and the check allows it.
  `ankiId` on cards/reviews is how `--replace` refuses to wipe Lara-native
  reviews without `--force`.
- **`prisma migrate dev` refuses to run non-interactively** (e.g. from an
  agent). Generate SQL with `prisma migrate diff --from-config-datasource
  --to-schema prisma/schema.prisma --script -o prisma/migrations/<ts>_<name>/migration.sql`,
  then `prisma migrate deploy` and `prisma generate`.
- **Migrations reach production only through `npm run db:migrate:deploy`.**
  `prisma.config.ts` targets Neon (`.env.neon-prod`) only for that script, any
  `*:prod` script, or `PRISMA_TARGET=production`; plain `npx prisma …` always
  hits the local DB. Check with `npm run db:migrate:status:prod` (read-only).
  Don't rename `.env.neon-prod` to `.env.production.local`: `next build` would
  auto-load it in any local production build.
- **Tests: `npm test` (unit) and `npm run test:int` (integration)** — see
  `tests/README.md`. No browser tests, by choice. The integration suite starts
  its own embedded Postgres and refuses non-loopback URLs; never point them elsewhere, never call real AI/TTS/Blob
  from a test, and keep test files serial (they share one database per run).

## Commands

```bash
npm run db:dev       # local Postgres (must be running for anything DB-backed)
npm run db:migrate   # after editing prisma/schema.prisma
npm run lint         # react-hooks/purity is an error, not a warning
npm run build        # runs prisma generate + tsc
npm run typecheck    # prisma generate + tsc --noEmit (includes tests)
npm test             # unit; npm run test:int for the DB-backed suite
npm run import:anki-collection -- "<…/Anki2/User 1/collection.anki2>" sv --dry-run
```
