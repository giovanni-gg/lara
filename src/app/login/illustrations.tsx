// Illustrations for the landing page: drawn in CSS and SVG from made-up
// examples, never from anyone's real decks. Decorative (aria-hidden) unless
// they carry meaning the text doesn't, and complete without any animation.

import { Check, Volume2 } from "lucide-react";
import { RATING_LABELS, type RatingValue } from "@/lib/srs";
import { cn } from "@/lib/utils";

const RATING_STYLES: Record<RatingValue, string> = {
  1: "bg-again/15 text-again border-again/40",
  2: "bg-hard/15 text-hard border-hard/40",
  3: "bg-good/15 text-good border-good/40",
  4: "bg-easy/15 text-easy border-easy/40",
};

/** Illustrative intervals for a card that's been seen a few times. */
const INTERVALS: Record<RatingValue, string> = { 1: "10m", 2: "1d", 3: "3d", 4: "8d" };
const RATINGS: RatingValue[] = [1, 2, 3, 4];

/**
 * The hero: a study card that turns over on a loop (äpple, then apple), the
 * answer buttons waking up once it's showing and Good being pressed. With
 * reduced motion it rests on the front, buttons fully visible. The side
 * padding on phones leaves room for the tilted cards underneath.
 */
export function HeroCard() {
  return (
    <div className="mx-auto w-full max-w-[22rem] px-3 sm:px-0" aria-hidden>
      <div className="relative [perspective:1400px]">
        {/* The rest of the deck, underneath. */}
        <div className="absolute inset-0 translate-x-3 translate-y-2 rotate-[5deg] rounded-[1.75rem] border border-line bg-raised" />
        <div className="absolute inset-0 -translate-x-2 translate-y-1 -rotate-[3deg] rounded-[1.75rem] border border-line bg-surface/70" />

        <div className="landing-card relative aspect-[7/8] w-full">
          <div className="card-face absolute inset-0 flex flex-col rounded-[1.75rem] border border-line bg-surface p-5 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.55)]">
            <span className="text-[13px] text-muted">Swedish</span>
            <div className="flex flex-1 flex-col items-center justify-center gap-5">
              <span className="font-display text-[clamp(3rem,14vw,4.25rem)] leading-none font-semibold tracking-tight">
                äpple
              </span>
              <span className="grid size-11 place-items-center rounded-full border border-line bg-raised text-muted">
                <Volume2 className="size-5" />
              </span>
            </div>
            <span className="rounded-xl bg-accent py-2.5 text-center text-sm font-semibold text-accent-ink">
              Show answer
            </span>
          </div>

          <div className="card-face card-face-back absolute inset-0 flex flex-col rounded-[1.75rem] border border-line bg-surface p-5 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.55)]">
            <span className="text-[13px] text-muted">Swedish</span>
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <span className="font-display text-4xl leading-none font-semibold tracking-tight">äpple</span>
              <span className="my-4 h-px w-16 bg-line" />
              <span className="text-2xl font-medium">apple</span>
            </div>
            <div className="rounded-xl border border-line bg-raised px-3 py-2.5">
              <p className="font-display text-[15px] leading-snug">Jag äter ett äpple varje dag.</p>
              <p className="mt-0.5 text-[13px] leading-snug text-muted">I eat an apple every day.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="landing-ratings mt-5 grid grid-cols-4 gap-2">
        {RATINGS.map((rating) => (
          <span
            key={rating}
            className={cn(
              "flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl border text-sm font-semibold",
              RATING_STYLES[rating],
              rating === 3 && "landing-press",
            )}
          >
            {RATING_LABELS[rating]}
            <span className="text-[11px] font-normal tabular-nums opacity-70">{INTERVALS[rating]}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** A small red apple with a leaf, for the picture-first card. */
function Apple({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <path
        d="M24 14c-3-2.6-7.4-3-10.6-.9C9 16 8.2 22.6 10.6 29c2.2 5.8 6.4 11 10.4 11 1.4 0 2.2-.7 3-.7s1.6.7 3 .7c4 0 8.2-5.2 10.4-11 2.4-6.4 1.6-13-2.8-15.9-3.2-2.1-7.6-1.7-10.6.9Z"
        className="fill-again"
      />
      <path d="M24 14c0-3 .8-5.6 2.6-7.6" fill="none" className="stroke-foreground/70" strokeWidth={2} strokeLinecap="round" />
      <path d="M26.4 8.6c2.6-2.6 6.4-3 8.8-2-1 2.8-4.6 4.8-8.8 2Z" className="fill-good" />
      <path d="M15 20c-1.4 2.4-1.6 5.4-.8 8" fill="none" stroke="white" strokeOpacity={0.45} strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

const FACES = [
  { title: "Swedish first", front: <span className="font-display text-lg font-medium">äpple</span>, answer: "apple" },
  { title: "English first", front: <span className="text-lg font-medium">apple</span>, answer: "äpple" },
  { title: "Picture first", front: <Apple className="size-10" />, answer: "äpple" },
];

/** The same word, three ways round. */
export function CardFaces() {
  return (
    <ul className="grid grid-cols-3 gap-3">
      {FACES.map((face) => (
        <li key={face.title} className="flex flex-col items-center gap-2">
          <div
            className="flex aspect-[4/5] w-full max-w-[5.5rem] flex-col items-center justify-center rounded-xl border border-line bg-raised px-1 shadow-sm"
            aria-hidden
          >
            <span className="flex h-10 items-center">{face.front}</span>
            <span className="my-1.5 h-px w-6 bg-line" />
            <span className="text-[11px] text-muted">{face.answer}</span>
          </div>
          <span className="text-center text-[12px] leading-tight text-muted">{face.title}</span>
        </li>
      ))}
    </ul>
  );
}

/** Two sentences from a made-up story, the second one playing. */
export function StorySnippet() {
  return (
    <div aria-hidden>
      <span className="inline-flex rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-[12px] font-medium text-accent">
        Written at B2, one level above B1
      </span>
      <p className="mt-3 font-display text-[15px] leading-relaxed">På lördagar cyklar Maja till torget.</p>
      <div className="mt-1.5 -mx-2 rounded-xl bg-accent/10 px-2 py-1.5">
        <p className="flex gap-2 font-display text-[15px] leading-relaxed">
          <Volume2 className="mt-1 size-4 shrink-0 text-accent" />
          <span>Hon köper äpplen av en gammal man som alltid skämtar om vädret.</span>
        </p>
        <p className="mt-0.5 pl-6 text-[13px] leading-snug text-muted">
          She buys apples from an old man who always jokes about the weather.
        </p>
      </div>
    </div>
  );
}

/** A moment from Speak: a word-order slip, and the correction that follows. */
export function SpeakCorrection() {
  return (
    <div className="flex flex-col gap-2 text-[14px] leading-snug" aria-hidden>
      <p className="max-w-[85%] self-start rounded-2xl rounded-bl-md bg-raised px-3 py-2 font-display">
        Vad gjorde du igår?
      </p>
      <p className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-accent px-3 py-2 font-display text-accent-ink">
        Igår jag åt ett äpple.
      </p>
      <div className="mt-1 rounded-xl border border-good/40 bg-good/10 px-3 py-2">
        <p className="flex items-center gap-1.5 font-display font-medium">
          <Check className="size-4 shrink-0 text-good" />
          Igår åt jag ett äpple.
        </p>
        <p className="mt-0.5 text-[13px] text-muted">After &ldquo;igår&rdquo;, the verb comes second.</p>
      </div>
    </div>
  );
}

const WEEKS = 12;
/**
 * Twelve weeks of made-up study days, 0 (none) to 4 (a lot): an irregular
 * start that settles into a streak over the last three weeks.
 */
const ACTIVITY: number[] = Array.from({ length: WEEKS * 7 }, (_, i) => {
  const level = ((i * 2654435761) >>> 0) % 5;
  return i >= (WEEKS - 3) * 7 ? Math.max(level, 1) : level;
});
const SHADES = ["bg-line", "bg-accent/25", "bg-accent/45", "bg-accent/70", "bg-accent"];

/** A study calendar in the shape of the "You" tab's. */
export function ActivityStrip() {
  return (
    <div aria-hidden>
      <div className="grid auto-cols-[1.125rem] grid-flow-col grid-rows-[repeat(7,1.125rem)] gap-[3px]">
        {ACTIVITY.map((level, i) => (
          <span key={i} className={cn("aspect-square rounded-[3px]", SHADES[level])} />
        ))}
      </div>
      <div className="mt-3 flex items-baseline gap-6 text-[13px] text-muted">
        <span>
          <span className="font-display text-lg font-semibold text-foreground tabular-nums">21</span> day streak
        </span>
        <span>
          <span className="font-display text-lg font-semibold text-foreground tabular-nums">87%</span> retention
        </span>
      </div>
    </div>
  );
}
