/**
 * A stylised forgetting curve for the "How Lara works" page. Illustrative,
 * not data: memory drops to the review line, a review lifts it back up, and
 * each drop after that is slower, so the reviews spread out.
 */

const W = 320;
const LEFT = 8;
const RIGHT = 312;
const TOP = 26; // fully remembered
const LINE = 74; // where Lara brings a card back (desired retention)
const BASE = 150; // the time axis

/** Fast at first, then slower: a normalised 0 → 1 decay over a tooth. */
function drop(u: number, k = 1.7): number {
  return (1 - Math.exp(-k * u)) / (1 - Math.exp(-k));
}

/** Gaps between reviews, each roughly twice the last. */
const GAPS = [20, 36, 64, 112];
const REVIEWS = GAPS.reduce<number[]>((xs, gap) => [...xs, (xs.at(-1) ?? LEFT) + gap], []);
/** The last gap would run off the edge; draw only its start. */
const TAIL_GAP = 210;

function tooth(x0: number, gap: number, until = 1): string {
  const steps = 18;
  let d = "";
  for (let i = 1; i <= steps; i++) {
    const u = (i / steps) * until;
    d += ` L${(x0 + u * gap).toFixed(1)} ${(TOP + (LINE - TOP) * drop(u)).toFixed(1)}`;
  }
  return d;
}

function reviewedPath(): string {
  let d = `M${LEFT} ${TOP}`;
  let x = LEFT;
  for (const gap of GAPS) {
    d += tooth(x, gap);
    x += gap;
    d += ` L${x} ${TOP}`; // the review lifts it back to the top
  }
  return d + tooth(x, TAIL_GAP, (RIGHT - x) / TAIL_GAP);
}

function unreviewedPath(): string {
  const steps = 40;
  let d = `M${LEFT} ${TOP}`;
  for (let i = 1; i <= steps; i++) {
    const u = i / steps;
    d += ` L${(LEFT + u * (RIGHT - LEFT)).toFixed(1)} ${(TOP + (BASE - 12 - TOP) * drop(u, 3.4)).toFixed(1)}`;
  }
  return d;
}

const REVIEWED = reviewedPath();
const UNREVIEWED = unreviewedPath();

export function ForgettingCurve({ retention }: { retention: number }) {
  const percent = Math.round(retention * 100);
  return (
    <svg
      viewBox={`0 0 ${W} 172`}
      className="block h-auto w-full"
      role="img"
      aria-labelledby="curve-title curve-desc"
    >
      <title id="curve-title">Forgetting curves, with and without reviews</title>
      <desc id="curve-desc">
        Without reviews, memory of a word falls steeply and keeps falling. With reviews, it
        only falls to the {percent}% line before each review lifts it back up, and every
        fall after a review is slower, so the reviews get further apart.
      </desc>

      {/* The review line: Lara's desired retention. */}
      <line
        x1={LEFT}
        x2={RIGHT}
        y1={LINE}
        y2={LINE}
        className="stroke-muted"
        strokeOpacity={0.45}
        strokeWidth={1}
        strokeDasharray="3 4"
      />
      <text x={RIGHT} y={LINE + 15} textAnchor="end" className="fill-muted text-[10px]">
        about {percent}% remembered
      </text>

      {/* Time axis, with a tick at each review. */}
      <line x1={LEFT} x2={RIGHT} y1={BASE} y2={BASE} className="stroke-line" strokeWidth={1} />
      {REVIEWS.map((x) => (
        <line key={x} x1={x} x2={x} y1={BASE} y2={BASE + 5} className="stroke-muted" strokeWidth={1} />
      ))}
      <text x={LEFT} y={BASE + 18} className="fill-muted text-[10px]">
        reviews
      </text>
      <text x={RIGHT} y={BASE + 18} textAnchor="end" className="fill-muted text-[10px]">
        time
      </text>

      {/* Without reviews: Ebbinghaus's curve, left alone. */}
      <path
        d={UNREVIEWED}
        fill="none"
        className="stroke-muted"
        strokeOpacity={0.7}
        strokeWidth={1.5}
        strokeDasharray="2 4"
        strokeLinecap="round"
      />
      <text x={RIGHT} y={BASE - 20} textAnchor="end" className="fill-muted text-[10px]">
        without reviews
      </text>

      {/* With reviews: the sawtooth that flattens. */}
      <path
        d={REVIEWED}
        fill="none"
        pathLength={1}
        className="curve-draw stroke-accent"
        strokeWidth={2.25}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {REVIEWS.map((x) => (
        <circle
          key={x}
          cx={x}
          cy={LINE}
          r={4}
          className="fill-accent stroke-surface"
          strokeWidth={2}
        />
      ))}
      <text x={RIGHT} y={TOP - 10} textAnchor="end" className="fill-foreground text-[10px] font-medium">
        with reviews
      </text>
    </svg>
  );
}
