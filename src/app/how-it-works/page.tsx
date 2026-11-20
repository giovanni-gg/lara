import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft, Sunrise, Timer } from "lucide-react";
import { getActiveProfile } from "@/lib/session";
import { RATING_LABELS, SCHEDULER_SETTINGS, type RatingValue } from "@/lib/srs";
import { PICTURE_FRONT, cardTypeGuide, mixingTip, type CardTypeGuide } from "@/lib/how-it-works";
import { ForgettingCurve } from "@/components/forgetting-curve";
import { ButtonLink, Screen } from "@/components/ui";
import { cn } from "@/lib/utils";

export const metadata = { title: "How LaraMig works · LaraMig" };

const RETENTION = SCHEDULER_SETTINGS.desiredRetention;
const STEP_MINUTES = parseInt(SCHEDULER_SETTINGS.relearningSteps[0], 10);
const DAY_STARTS = `${String(SCHEDULER_SETTINGS.dayStartsAtHour).padStart(2, "0")}:00`;

// The same tints as the study screen's answer buttons.
const RATINGS: { rating: RatingValue; tone: string; meaning: string }[] = [
  {
    rating: 1,
    tone: "bg-again/15 text-again border-again/40",
    meaning: `You didn't know it. It comes back in ${STEP_MINUTES} minutes.`,
  },
  {
    rating: 2,
    tone: "bg-hard/15 text-hard border-hard/40",
    meaning: "You got it, but it was a struggle. A shorter wait than Good.",
  },
  {
    rating: 3,
    tone: "bg-good/15 text-good border-good/40",
    meaning: "You remembered. The normal answer: use it most.",
  },
  {
    rating: 4,
    tone: "bg-easy/15 text-easy border-easy/40",
    meaning: "Instant, no effort at all. A longer jump ahead.",
  },
];

export default async function HowItWorksPage() {
  const { active } = await getActiveProfile();
  const cardTypes = cardTypeGuide(active);

  return (
    <Screen>
      <div className="pt-4">
        <Link href="/decks" className="inline-flex items-center gap-1 py-1 text-xs text-muted">
          <ChevronLeft className="size-3.5" aria-hidden />
          Decks
        </Link>
      </div>

      <header className="mt-2">
        <h1 className="font-display text-[30px] leading-[1.1] font-semibold tracking-tight text-balance">
          How LaraMig works
        </h1>
        <p className="mt-2.5 text-[15px] leading-relaxed text-muted text-pretty">
          One idea does most of the work: see each word again just before you would forget it.
          That&apos;s spaced repetition.
        </p>
      </header>

      <figure className="mt-5 rounded-2xl border border-line bg-surface px-3 pt-4 pb-3 shadow-sm">
        <ForgettingCurve retention={RETENTION} />
        <figcaption className="mt-2 px-1 text-xs leading-snug text-muted">
          An illustration, not your data. Each dot is a review: it lifts the memory back up,
          and the next fall is slower.
        </figcaption>
      </figure>

      <Section title="You forget on a curve">
        <p>
          In the 1880s Hermann Ebbinghaus tested his own memory and found that new things fade
          fast at first, then more slowly. Each time you recall a word at the right moment, it
          fades more slowly than before, so the gaps between reviews can grow: a day, a few
          days, weeks, months.
        </p>
      </Section>

      <Section title="Why it works">
        <dl className="space-y-3">
          <Idea term="Spacing beats cramming">
            Practice spread over days sticks far better than the same practice in one sitting.
            This is the spacing effect, one of the most reliable findings in memory research.
          </Idea>
          <Idea term="Recalling beats re-reading">
            Pulling a word out of memory strengthens it more than looking at it again. That&apos;s
            retrieval practice, or the testing effect, which is why every card asks before it
            shows.
          </Idea>
        </dl>
      </Section>

      <Section title="How LaraMig picks the moment">
        <p>
          LaraMig schedules with FSRS, a modern open-source algorithm (Anki uses it too). It keeps
          a small model of each card&apos;s memory, how stable it is and how hard it is for you,
          and updates it every time you answer.
        </p>
        <p>
          A card comes back when FSRS predicts you&apos;d have about a {Math.round(RETENTION * 100)}%
          chance of remembering it. Not 100% on purpose: a recall that takes a little effort
          does more for your memory, and you&apos;re spared a lot of reviews.
        </p>
        <ul className="grid grid-cols-2 gap-2 text-[13px] leading-snug">
          <li className="flex gap-2 rounded-xl bg-raised px-3 py-2.5">
            <Timer className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
            <span>A missed card returns after {STEP_MINUTES} minutes.</span>
          </li>
          <li className="flex gap-2 rounded-xl bg-raised px-3 py-2.5">
            <Sunrise className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
            <span>The study day starts at {DAY_STARTS}, so late nights count as today.</span>
          </li>
        </ul>
      </Section>

      <Section title="Your four answers">
        <p>After you turn a card over, say how it went. Each button shows when the card would come back.</p>
        <ul className="space-y-2">
          {RATINGS.map(({ rating, tone, meaning }) => (
            <li key={rating} className="flex items-start gap-3">
              <span
                className={cn(
                  "mt-px w-14 shrink-0 rounded-lg border py-1 text-center text-[13px] font-semibold",
                  tone,
                )}
              >
                {RATING_LABELS[rating]}
              </span>
              <span className="pt-1 text-[14px] leading-snug">{meaning}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Three ways to face a card">
        <p>Every card has two sides. Which one you see first changes what you practise.</p>
        <ul className="divide-y divide-line">
          {cardTypes.map((type) => (
            <CardType key={type.kind} type={type} />
          ))}
        </ul>
        <p className="rounded-xl border border-accent/30 bg-accent/10 px-3.5 py-3 text-[14px] leading-snug">
          {mixingTip(active)}
        </p>
      </Section>

      <Section title="A few habits">
        <dl className="space-y-3">
          <Idea term="A little, every day">
            Ten minutes a day does more than an hour on Sunday. That&apos;s the spacing effect
            again, working for you.
          </Idea>
          <Idea term="Keep new cards low">
            Each deck brings in 5 new cards a day unless you change it. Reviews are never capped,
            and today&apos;s new cards are next month&apos;s reviews.
          </Idea>
          <Idea term="Be honest with Again">
            If you didn&apos;t know it, say so. A generous Good sends the card too far away, and
            it comes back already forgotten.
          </Idea>
        </dl>
      </Section>

      <div className="mt-9 mb-4">
        <ButtonLink href="/decks" variant="secondary" className="w-full">
          Back to your decks
        </ButtonLink>
      </div>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-9">
      <h2 className="font-display text-xl font-semibold tracking-tight">{title}</h2>
      <div className="mt-2.5 space-y-3 text-[15px] leading-relaxed text-foreground/90 text-pretty">
        {children}
      </div>
    </section>
  );
}

function Idea({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="border-l-2 border-accent/60 pl-3">
      <dt className="font-semibold">{term}</dt>
      <dd className="mt-0.5 text-muted">{children}</dd>
    </div>
  );
}

function CardType({ type }: { type: CardTypeGuide }) {
  const picture = type.front === PICTURE_FRONT;
  return (
    <li className="flex gap-4 py-4 first:pt-1">
      {/* A tiny flashcard: this type's front, and under the rule, what you answer. */}
      <div className="relative mt-1 h-[92px] w-[72px] shrink-0" aria-hidden>
        <div className="absolute inset-0 translate-x-1.5 rotate-6 rounded-xl border border-line bg-raised" />
        <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl border border-line bg-surface px-1 shadow-sm">
          <span
            className={cn(
              "max-w-full truncate",
              picture ? "text-[34px] leading-none" : "font-display text-[17px] font-medium",
            )}
          >
            {type.front}
          </span>
          <span className="my-1.5 h-px w-6 bg-line" />
          <span className="max-w-full truncate text-[10px] text-muted">{type.answer}</span>
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-display text-[17px] font-semibold">{type.title}</h3>
          <Effort level={type.effort} label={type.effortLabel} />
        </div>
        <p className="text-[13px] text-muted">{type.skill}</p>
        <p className="mt-1.5 text-[14px] leading-snug">{type.body}</p>
        <p className="mt-1.5 text-[13px] font-medium text-accent">{type.howMany}</p>
      </div>
    </li>
  );
}

/** Three rising bars, filled up to how hard the type is. */
function Effort({ level, label }: { level: 1 | 2 | 3; label: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted">
      {label}
      <span className="flex items-end gap-[3px]" aria-hidden>
        {[1, 2, 3].map((bar) => (
          <span
            key={bar}
            className={cn("w-[4px] rounded-full", bar <= level ? "bg-accent" : "bg-line")}
            style={{ height: `${4 + bar * 3}px` }}
          />
        ))}
      </span>
    </span>
  );
}
