# Tests

```bash
npm test                                             # unit (vitest.config.mts), ~1 s
npm test -- src/lib/srs.test.ts                      # one file
npm run test:watch                                   # re-run on save
npm run test:int                                     # integration (vitest.integration.config.mts), ~20 s
npm run test:int -- tests/integration/study.test.ts  # one file
npm run test:int:watch
npm run typecheck                                    # tsc over app AND tests (vitest doesn't type-check)
```

There are no browser tests, by choice.

## The rules

- **Loopback only.** The integration suite starts its own PostgreSQL 17 on
  `127.0.0.1` and refuses any other address (`src/lib/local-database.ts`).
  Never point a test at `.env`'s `prisma dev` database or at Neon.
- **Never real AI, TTS or Blob.** `tests/integration/setup.ts` blanks
  `ANTHROPIC_API_KEY`, `AI_GATEWAY_API_KEY`, `ELEVENLABS_API_KEY`, `GEMINI_API_KEY`,
  `BLOB_READ_WRITE_TOKEN` and `VERCEL_OIDC_TOKEN` and sets
  `MEDIA_STORAGE=local`, so the app takes its "not configured" paths: AI
  throws `MissingAiCredentialsError` (routes answer 503), TTS is skipped. To
  test an AI or TTS path, `vi.mock` the module (`@/lib/ai/model`, `@/lib/tts`)
  or stub `fetch`; never add a real key.
- **Files run one at a time.** A run has ONE database, shared by every file,
  and every test truncates it (`fileParallelism: false`). Two runs at once are
  fine: each starts its own server.
- **Migrations go through Prisma.** The harness runs `prisma migrate deploy`
  (`tests/embedded-postgres.ts`), so the test schema is exactly what production
  gets. Never create or alter tables with raw SQL in a test.

## Which layer

| Layer | Where | Proves | Database |
| --- | --- | --- | --- |
| Unit | `src/**/*.test.ts`, `scripts/**/*.test.ts`, next to the code | the rules: scheduling, tree building, parsing | none, keep it pure |
| Integration | `tests/integration/**/*.test.ts` | the row changed: lib functions, route handlers and server actions against Postgres | embedded, reset before every test |

If it can be a unit test, make it one. Unit tests may import `@/…` and the
generated enums (`@/generated/prisma/enums`), but nothing that reaches
`@/lib/db`.

## Integration tests

`global-setup.ts` starts the database once per run and migrates it. `setup.ts`
runs before each file: it forces that URL onto `DATABASE_URL` (before anything
imports `src/lib/db.ts`, which caches its client on `globalThis`), sets
`LARA_USER_EMAIL` to `TEST_USER_EMAIL`, blanks the AI/TTS/Blob keys, deletes
`LARA_PASSWORD` (gate open), and **truncates every table before every test**
(`resetDatabase` in `db.ts`). So:

- Build the rows a test needs inside the test or in `beforeEach`, **never in
  `beforeAll`** (the reset runs after it and wipes them).
- Import app code the way the app does: `import { buildQueue } from "@/lib/study"`.
  `prisma` from `@/lib/db` is the real client on the test database.
- Route handlers are plain functions: `await POST(new Request("http://t/api/…",
  { method: "POST", body: JSON.stringify(…) }))`, then read `res.status` /
  `await res.json()`.
- Set an env var a test needs (`LARA_PASSWORD`, …) in `beforeEach` and delete
  it in `afterEach`, as `login.test.ts` does.

Next's request-only modules are stubbed (`stubs/`); everything else is real:

| Import | Stub behaviour | Test controls |
| --- | --- | --- |
| `next/headers` | `cookies()` / `headers()` over an in-memory store; `cookies().set()` works | `setCookie`, `getCookie`, `getCookieOptions`, `setHeader` (from `./stubs/next-headers`) |
| `next/navigation` | `redirect(url)` throws `RedirectError` (`.url`), `notFound()` throws `NotFoundError` | `await expect(action()).rejects.toMatchObject({ url: "/" })` |
| `next/cache` | `revalidatePath` / `revalidateTag` / `updateTag` / `refresh` are recorded | `revalidated` array (from `./stubs/next-cache`) |
| `next/server` | real `NextResponse` / `NextRequest`; `after(cb)` queues `cb` instead of running it after a response | `await settleAfter()` runs the queue (from `./stubs/next-server`); `pictures.test.ts` is the example |
| `server-only` | empty | |

All of these are reset before every test. `login.test.ts` is the worked
example of a server action using them.

## Factories and the fixture world

`tests/factories.ts` (writes rows) and `tests/world.ts` (pure names). Each
factory takes the parent row plus column overrides and fills valid, distinct
defaults:

```ts
import { createUser, createProfile, createDeck, createCard, createCards,
  createReview, createWorld, dueReview, futureReview, learning } from "../factories";

const user = await createUser();                         // THE session user (LARA_USER_EMAIL)
const other = await createUser({ email: "x@lara.local" });
const profile = await createProfile(user, { level: "B1" });   // active, Swedish
const deck = await createDeck(profile, { name: "Verbs", newCardsPerDay: 2 });
const sub = await createDeck(profile, { parent: deck });
const archived = await createDeck(profile, { archivedAt: new Date() });
const card = await createCard(deck);                     // NEW, RECOGNITION
await createCard(deck, { ...dueReview(now), cardType: "PRODUCTION" });
await createCards(deck, 30, (i) => ({ target: `ord ${i}` })); // createdAt in index order
await createReview(card, { reviewedAt: now, rating: 1 }); // a log row only
```

- Scheduling presets to spread into `createCard`: `dueReview(now, overdueDays)`,
  `futureReview(now, inDays)`, `learning(now, inMinutes)`.
- `createReview` writes the log row only. To exercise answering a card for
  real, call `submitReview` from `@/lib/study`.
- A card counts as "introduced today" when its FIRST review is at or after the
  study-day start (04:00 local, `startOfStudyDay` in `@/lib/srs`); build that
  with `createReview(card, { reviewedAt })`.
- Pass `now` explicitly to the factories AND to the code under test, so a run
  near 04:00 or midnight can't flake.

`createWorld({ now?, profile? })` builds the standard fixture and returns
handles to every row (`world.decks.food`, `world.cards.picture`, …). Its decks
keep the default `newCardsPerDay` (5), above the one or two new cards each
holds:

```
Svenska                 hej → hello        RECOGNITION, new
│                       katt → cat         suspended
└─ Mat                  äpple → apple      PRODUCTION, new
   └─ Frukt             banan → banana     PICTURE (/api/media/test-banana.png), new
Verb                    springa → to run   REVIEW, due yesterday
```

The names live in `WORLD` (`tests/world.ts`). Assert against those rather
than retyping strings.

## Housekeeping

- A run that is killed (Ctrl-C) leaves its cluster in the temp folder; the
  next run deletes such leftovers (`removeStaleClusters`). Its `postgres.exe`
  may linger too; it is harmless.
- The first run on a machine is slower while the Postgres binaries unpack.
