<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Lara

Language-learning app: FSRS flashcards, AI-generated decks, immersion articles.
See `README.md` for what it is and how to run it.

## Non-obvious constraints

- **`src/lib/srs.ts` is the only file that imports `ts-fsrs`.** Everything else
  goes through `applyReview` / `previewIntervals`. Keeps the algorithm swappable
  and the FSRS↔Prisma enum mapping in one place.
- **`src/lib/session.ts` is the only file that knows who the user is.** Real auth
  replaces that file and nothing else. Don't read the user identity elsewhere.
- **Never write a per-deck stats loop.** `deckStats` is for one deck; for a list
  use `statsByDeck`, which does it in grouped queries. `prisma dev` allows 10
  connections, and 27 decks × 4 counts exhausts the pool and 500s the page.
- **Reviews and new cards have independent daily caps.** Use `sessionSize` to
  report how many cards a session will serve — `min(due + fresh, reviewLimit +
  newLimit)` is wrong and over-promises.
- **Every page is `dynamic = "force-dynamic"`** (set on the root layout). All of
  it is per-user; nothing is prerenderable.
- **Form-bound server actions must return `void`.** Throw on validation failure;
  returning `{ error }` from an `action={}` prop is a type error.
- **Articles are generated at `nextLevelUp(profile.level)`, not at the profile's
  level.** That i+1 gap is the point of the feature, not a bug.
- **Prisma 7:** client is generated to `src/generated/prisma` (gitignored) and
  needs a driver adapter. `import { PrismaClient } from "@/generated/prisma/client"`,
  never from `@prisma/client`.
- **TTS is content-hash cached** in `.media/`. Re-synthesising identical text is
  free, so don't add your own caching layer around it.

## Commands

```bash
npm run db:dev       # local Postgres (must be running for anything DB-backed)
npm run db:migrate   # after editing prisma/schema.prisma
npm run lint         # react-hooks/purity is an error, not a warning
npm run build        # runs prisma generate + tsc
```
