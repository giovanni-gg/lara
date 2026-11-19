import "dotenv/config";
import { importAnkiCollection, type ImportArgs } from "./anki/import";

/**
 * Brings an Anki profile into Lara: decks, cards, media, scheduling state, and
 * the full review history.
 *
 * Usage:
 *   npm run import:anki-collection -- "<…/Anki2/User 1/collection.anki2>" sv [--dry-run] [--replace] [--force]
 *
 *   --dry-run  Parse and report; write nothing.
 *   --replace  Delete every deck in the target language profile first. Required
 *              when the profile already has cards.
 *   --force    Allow --replace to delete reviews done in Lara (not imported).
 *              Without it the importer refuses, so re-importing a newer Anki
 *              collection can never silently discard Lara-native progress.
 *
 * Anki is never written to: the collection is copied to a temp dir and opened
 * read-only, so this is safe while Anki is running.
 *
 * Content mapping (Anki "Basic" notes, Front/Back):
 *   picture on the front   -> PICTURE      (back: word, translation, sentence, sentence translation)
 *   audio on the front     -> RECOGNITION  (front is the target language)
 *   audio on the back      -> PRODUCTION   (back is the target language)
 *   no audio               -> RECOGNITION
 *
 * The import itself lives in scripts/anki/import.ts, the field parsing in
 * scripts/anki/parse.ts.
 */

function parseArgs(): ImportArgs {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const [collectionPath, targetLanguage, sourceLanguage = "en"] = argv.filter(
    (a) => !a.startsWith("--"),
  );
  if (!collectionPath || !targetLanguage) {
    console.error(
      'Usage: npm run import:anki-collection -- "<path/to/collection.anki2>" <target-language> [source-language] [--dry-run] [--replace] [--force]',
    );
    process.exit(1);
  }
  return {
    collectionPath,
    targetLanguage,
    sourceLanguage,
    dryRun: flags.has("--dry-run"),
    replace: flags.has("--replace"),
    force: flags.has("--force"),
  };
}

async function main() {
  await importAnkiCollection(parseArgs());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
