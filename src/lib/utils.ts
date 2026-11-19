import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** "in 3 days", "now", "2 hours ago" — compact enough for a phone screen. */
/** Kept out of components so render stays pure (react-hooks/purity). */
export function isPast(date: Date, now = new Date()): boolean {
  return date.getTime() <= now.getTime();
}

export function relativeTime(date: Date, now = new Date()): string {
  const diffMs = date.getTime() - now.getTime();
  const abs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (abs < minute) return "now";

  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [day * 365, "year"],
    [day * 30, "month"],
    [day, "day"],
    [hour, "hour"],
    [minute, "minute"],
  ];

  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [ms, unit] of units) {
    if (abs >= ms) return formatter.format(Math.round(diffMs / ms), unit);
  }
  return "now";
}

export function formatCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
