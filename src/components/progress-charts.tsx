import type { ReactNode } from "react";
import { Panel } from "@/components/ui";
import {
  ACTIVITY_WEEKS,
  FORECAST_DAYS,
  KNOWN_INTERVAL_DAYS,
  RETENTION_DAYS,
  activityLevels,
  daysBetween,
  formatCount,
  formatDay,
  formatMonth,
  niceCeil,
  weekdayIndex,
  weekdayLetter,
  type DayValue,
  type Progress,
} from "@/lib/progress";
import { cn } from "@/lib/utils";

/**
 * The learner's journey at the top of the "You" tab: four tiles and three
 * small charts. Plain server-rendered SVG — no chart library, no client JS.
 * Hover readouts are native `<title>`s; every chart has an aria-label summary.
 * Colours are the app's tokens, so light and dark both follow globals.css:
 * reviews done and cards due are `good` (the Done tile, the deck list's Due
 * column), the journey line is the accent.
 */
export function ProgressSection({ progress }: { progress: Progress }) {
  const { streak, retention } = progress;
  return (
    <section className="mb-5 space-y-3" aria-label="Your progress">
      <div className="grid grid-cols-4 gap-2">
        <Tile value={streak.current} label="Streak" sub={`best ${streak.best}`} />
        <Tile
          value={formatCount(progress.known)}
          label="Known"
          sub={`${progress.knownGained >= 0 ? "+" : "−"}${formatCount(Math.abs(progress.knownGained))} in ${RETENTION_DAYS}d`}
        />
        <Tile
          value={progress.reviewsToday}
          label="Today"
          sub={`${formatCount(progress.reviewsTotal)} total`}
        />
        <Tile
          value={retention === null ? "–" : `${Math.round(retention * 100)}%`}
          label="Retention"
          sub={`last ${RETENTION_DAYS}d`}
        />
      </div>

      {progress.reviewsTotal > 0 ? (
        <>
          <ChartPanel
            title="Words known"
            subtitle={`Cards with an interval of ${KNOWN_INTERVAL_DAYS}+ days`}
          >
            <JourneyChart series={progress.knownSeries} />
          </ChartPanel>
          <ChartPanel title="Activity" subtitle={`Reviews per day, last ${ACTIVITY_WEEKS} weeks`}>
            <ActivityHeatmap days={progress.activity} today={progress.today} />
          </ChartPanel>
        </>
      ) : null}

      {progress.forecast.some((d) => d.value > 0) ? (
        <ChartPanel
          title="Coming up"
          subtitle={`Reviews falling due, next ${FORECAST_DAYS} days`}
          aside={`${formatCount(sum(progress.forecast.slice(0, 7)))} in 7 days`}
        >
          <ForecastChart days={progress.forecast} />
        </ChartPanel>
      ) : null}
    </section>
  );
}

const sum = (days: DayValue[]) => days.reduce((n, d) => n + d.value, 0);

function Tile({ value, label, sub }: { value: ReactNode; label: string; sub: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-raised px-1 py-2 text-center">
      <div className="font-display text-xl font-semibold leading-none">{value}</div>
      <div className="mt-1 truncate text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className="truncate text-[10px] text-muted">{sub}</div>
    </div>
  );
}

function ChartPanel({
  title,
  subtitle,
  aside,
  children,
}: {
  title: string;
  subtitle: string;
  aside?: string;
  children: ReactNode;
}) {
  return (
    <Panel>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-sm font-semibold">{title}</h2>
          <p className="truncate text-[11px] text-muted">{subtitle}</p>
        </div>
        {aside ? <span className="shrink-0 text-xs text-muted">{aside}</span> : null}
      </div>
      {children}
    </Panel>
  );
}

// ---- words known over time ---------------------------------------------------

function JourneyChart({ series }: { series: DayValue[] }) {
  const max = Math.max(0, ...series.map((p) => p.value));
  if (series.length < 2 || max === 0) {
    return (
      <p className="py-3 text-center text-xs text-muted">
        A card counts as known once its interval reaches {KNOWN_INTERVAL_DAYS} days.
      </p>
    );
  }

  const W = 300;
  const H = 120;
  const left = 30;
  const right = W - 6;
  const top = 14;
  const bottom = H - 16;
  const yMax = niceCeil(max);
  const first = series[0].day;
  const span = Math.max(1, daysBetween(first, series.at(-1)!.day));
  const x = (day: string) => left + ((right - left) * daysBetween(first, day)) / span;
  const y = (value: number) => bottom - ((bottom - top) * value) / yMax;

  const line = series.map((p, i) => `${i ? "L" : "M"}${x(p.day).toFixed(1)} ${y(p.value).toFixed(1)}`).join("");
  const area = `${line}L${right} ${bottom}L${left} ${bottom}Z`;
  const end = series.at(-1)!;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="block w-full"
      role="img"
      aria-label={`Words known grew from ${formatCount(series[0].value)} in ${formatMonth(first)} to ${formatCount(end.value)} today.`}
    >
      {[0, yMax / 2, yMax].map((tick) => (
        <g key={tick}>
          <line x1={left} x2={right} y1={y(tick)} y2={y(tick)} className="stroke-line" strokeWidth={1} />
          <text x={left - 4} y={y(tick) + 3} textAnchor="end" fontSize={9} className="fill-muted tabular-nums">
            {formatCount(tick)}
          </text>
        </g>
      ))}
      <path d={area} className="fill-accent" fillOpacity={0.1} />
      <path d={line} className="stroke-accent" fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(end.day)} cy={y(end.value)} r={4} className="fill-accent stroke-surface" strokeWidth={2} />
      <text x={x(end.day)} y={y(end.value) - 8} textAnchor="end" fontSize={10} fontWeight={600} className="fill-foreground">
        {formatCount(end.value)}
      </text>
      <text x={left} y={H - 3} fontSize={9} className="fill-muted">
        {formatMonth(first)}
      </text>
      <text x={right} y={H - 3} textAnchor="end" fontSize={9} className="fill-muted">
        Today
      </text>
      {/* Hover targets: one column per point, wider than the line. */}
      {series.map((p, i) => {
        const prev = i ? x(series[i - 1].day) : left;
        const next = i < series.length - 1 ? x(series[i + 1].day) : right;
        const from = (prev + x(p.day)) / 2;
        return (
          <rect key={p.day} x={from} y={top} width={Math.max(1, (x(p.day) + next) / 2 - from)} height={bottom - top} fill="transparent">
            <title>{`${formatDay(p.day)}: ${formatCount(p.value)} words known`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

// ---- reviews per day ---------------------------------------------------------

const SHADES = [0, 0.35, 0.55, 0.8, 1];

function ActivityHeatmap({ days, today }: { days: DayValue[]; today: string }) {
  const cell = 14;
  const pitch = 17;
  const labelW = 12;
  const monthH = 12;
  const W = labelW + ACTIVITY_WEEKS * pitch - (pitch - cell);
  const H = monthH + 7 * pitch - (pitch - cell);
  const levels = activityLevels(days.map((d) => d.value));
  const active = days.filter((d) => d.value > 0).length;
  const total = sum(days);

  return (
    <>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        role="img"
        aria-label={`${formatCount(total)} reviews on ${active} of ${days.length} days.`}
      >
        {["M", "", "W", "", "F", "", ""].map((letter, row) =>
          letter ? (
            <text key={row} x={0} y={monthH + row * pitch + cell - 3} fontSize={9} className="fill-muted">
              {letter}
            </text>
          ) : null,
        )}
        {days.map((d, i) => {
          const week = Math.floor(i / 7);
          const row = weekdayIndex(d.day);
          const level = levels[i];
          const startsMonth = row === 0 && Number(d.day.slice(8)) <= 7;
          return (
            <g key={d.day}>
              {startsMonth ? (
                <text x={labelW + week * pitch} y={9} fontSize={9} className="fill-muted">
                  {formatMonth(d.day, false)}
                </text>
              ) : null}
              <rect
                x={labelW + week * pitch}
                y={monthH + row * pitch}
                width={cell}
                height={cell}
                rx={3}
                className={cn(level ? "fill-good" : "fill-line", d.day === today && "stroke-foreground")}
                fillOpacity={level ? SHADES[level] : 1}
                strokeWidth={d.day === today ? 1 : 0}
              >
                <title>{`${formatDay(d.day)}: ${d.value} ${d.value === 1 ? "review" : "reviews"}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-muted">
        <span>
          {formatCount(total)} reviews · {active} of {days.length} days
        </span>
        <span className="flex items-center gap-1" aria-hidden>
          Less
          {SHADES.map((opacity, level) => (
            <span
              key={level}
              className={cn("size-2.5 rounded-[3px]", level ? "bg-good" : "bg-line")}
              style={level ? { opacity } : undefined}
            />
          ))}
          More
        </span>
      </div>
    </>
  );
}

// ---- cards due ahead ---------------------------------------------------------

function ForecastChart({ days }: { days: DayValue[] }) {
  const W = 300;
  const H = 84;
  const top = 12;
  const bottom = H - 14;
  const pitch = W / days.length;
  const barW = 12;
  const max = Math.max(1, ...days.map((d) => d.value));
  const peak = days.findIndex((d) => d.value === max);
  const h = (value: number) => ((bottom - top) * value) / max;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="block w-full"
      role="img"
      aria-label={`${days[0].value} due tomorrow; the busiest day has ${max}.`}
    >
      <line x1={0} x2={W} y1={bottom} y2={bottom} className="stroke-line" strokeWidth={1} />
      {days.map((d, i) => {
        const cx = pitch * i + pitch / 2;
        const height = h(d.value);
        const labelled = d.value > 0 && (i === 0 || i === peak);
        return (
          <g key={d.day}>
            {height > 0 ? <path d={columnPath(cx - barW / 2, bottom, barW, height)} className="fill-good" /> : null}
            {labelled ? (
              <text x={cx} y={bottom - height - 3} textAnchor="middle" fontSize={9} className="fill-foreground tabular-nums">
                {formatCount(d.value)}
              </text>
            ) : null}
            <text x={cx} y={H - 2} textAnchor="middle" fontSize={9} className="fill-muted">
              {weekdayLetter(d.day)}
            </text>
            <rect x={pitch * i} y={0} width={pitch} height={H} fill="transparent">
              <title>{`${i === 0 ? "Tomorrow" : formatDay(d.day)}: ${d.value} due`}</title>
            </rect>
          </g>
        );
      })}
    </svg>
  );
}

/** A column with a 4px rounded top and a square foot on the baseline. */
function columnPath(x: number, baseline: number, width: number, height: number): string {
  const r = Math.min(4, height, width / 2);
  const top = baseline - height;
  return [
    `M${x} ${baseline}`,
    `V${top + r}`,
    `Q${x} ${top} ${x + r} ${top}`,
    `H${x + width - r}`,
    `Q${x + width} ${top} ${x + width} ${top + r}`,
    `V${baseline}`,
    "Z",
  ].join("");
}
