import { ImageIcon } from "lucide-react";
import { AudioButton } from "@/components/audio-button";
import { CardChatButton } from "@/components/card-chat-button";
import { Badge } from "@/components/ui";
import { deleteCard, toggleCardSuspended } from "@/app/actions";
import { isPast, relativeTime } from "@/lib/utils";
import type { CardType, FsrsState } from "@/generated/prisma/enums";

type CardSummary = {
  id: string;
  target: string;
  source: string;
  targetSentence: string | null;
  notes: string | null;
  audioUrl: string | null;
  imageUrl: string | null;
  cardType: CardType;
  state: FsrsState;
  due: Date;
  suspended: boolean;
};

/**
 * A card as it appears in a deck listing: one slim row inside a divided list
 * (the parent <ul> draws the border). Expands with <details> so the list stays
 * scannable on a phone but the full content is one tap away.
 */
export function CardRow({
  card,
  languages,
}: {
  card: CardSummary;
  /** Language codes, for the "EN→SV" marker on production cards. */
  languages?: { target: string; source: string };
}) {
  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-2.5 active:bg-raised">
          {card.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- local media, already sized
            <img
              src={card.imageUrl}
              alt=""
              loading="lazy"
              className="size-9 shrink-0 rounded-lg border border-line object-cover"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="font-display truncate text-[15px] font-medium leading-tight">
              {card.target}
            </p>
            <p className="truncate text-xs leading-tight text-muted">
              <DirectionMarker type={card.cardType} languages={languages} />
              {card.source}
            </p>
          </div>
          {card.suspended ? (
            <Badge className="border-again/40 text-again">paused</Badge>
          ) : card.state === "NEW" ? (
            <Badge>new</Badge>
          ) : (
            // Overdue reads as "due", like Anki — "19 days ago" looked like last-seen.
            isPast(card.due) ? (
              <Badge className="border-good/40 text-good">due</Badge>
            ) : (
              <Badge>{relativeTime(card.due)}</Badge>
            )
          )}
          <AudioButton src={card.audioUrl} size="sm" label={`Hear ${card.target}`} />
        </summary>

        <div className="border-t border-line bg-raised/40 px-3 py-2.5">
          {card.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- local media, already sized
            <img
              src={card.imageUrl}
              alt={card.target}
              loading="lazy"
              className="mb-2 max-h-40 rounded-lg border border-line object-contain"
            />
          ) : null}
          {card.targetSentence ? (
            <p className="font-display text-sm leading-snug">{card.targetSentence}</p>
          ) : null}
          {card.notes ? (
            <p className="mt-1.5 whitespace-pre-line text-xs text-muted">{card.notes}</p>
          ) : null}

          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <CardChatButton card={card} />
            <form
              action={async () => {
                "use server";
                await toggleCardSuspended(card.id);
              }}
            >
              <button
                type="submit"
                className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted"
              >
                {card.suspended ? "Resume" : "Pause"}
              </button>
            </form>
            <form
              action={async () => {
                "use server";
                await deleteCard(card.id);
              }}
            >
              <button
                type="submit"
                className="rounded-lg border border-again/40 px-3 py-1.5 text-xs text-again"
              >
                Delete
              </button>
            </form>
          </div>
        </div>
      </details>
    </li>
  );
}

/** Recognition is the default and unmarked; anything else gets a quiet prefix. */
function DirectionMarker({
  type,
  languages,
}: {
  type: CardType;
  languages?: { target: string; source: string };
}) {
  const MARK = "mr-1.5 inline-flex items-center align-[-1px] text-[10px] font-semibold uppercase tracking-wide text-muted/80";

  switch (type) {
    case "PRODUCTION":
      return (
        <span className={MARK} title="Production: see the translation, produce the word">
          {languages ? `${languages.source}→${languages.target}` : "rev"}
        </span>
      );
    case "PICTURE":
      return (
        <span className={MARK} title="Picture card">
          <ImageIcon className="size-3" aria-label="Picture card" />
        </span>
      );
    case "CLOZE":
      return <span className={MARK}>cloze</span>;
    case "TYPING":
      return <span className={MARK}>typing</span>;
    default:
      return null;
  }
}
