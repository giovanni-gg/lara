import { AudioButton } from "@/components/audio-button";
import { CardChatButton } from "@/components/card-chat-button";
import { Badge } from "@/components/ui";
import { deleteCard, toggleCardSuspended } from "@/app/actions";
import { relativeTime } from "@/lib/utils";
import type { FsrsState } from "@/generated/prisma/enums";

type CardSummary = {
  id: string;
  target: string;
  source: string;
  targetSentence: string | null;
  notes: string | null;
  audioUrl: string | null;
  state: FsrsState;
  due: Date;
  suspended: boolean;
};

/**
 * A card as it appears in a deck listing. Expands with <details> so the list
 * stays scannable on a phone but the full content is one tap away.
 */
export function CardRow({ card }: { card: CardSummary }) {
  return (
    <li>
      <details className="group rounded-2xl border border-line bg-surface">
        <summary className="flex cursor-pointer list-none items-center gap-3 p-4">
          <div className="min-w-0 flex-1">
            <p className="font-display truncate text-base font-medium">
              {card.target}
            </p>
            <p className="truncate text-sm text-muted">{card.source}</p>
          </div>
          {card.suspended ? (
            <Badge className="border-again/40 text-again">paused</Badge>
          ) : card.state === "NEW" ? (
            <Badge>new</Badge>
          ) : (
            <Badge>{relativeTime(card.due)}</Badge>
          )}
          <AudioButton src={card.audioUrl} size="sm" label={`Hear ${card.target}`} />
        </summary>

        <div className="border-t border-line px-4 py-3">
          {card.targetSentence ? (
            <p className="font-display text-sm leading-snug">
              {card.targetSentence}
            </p>
          ) : null}
          {card.notes ? (
            <p className="mt-2 text-xs text-muted">{card.notes}</p>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
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
