"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-fetches the current server page every few seconds while `active` — used
 * while a story is being written in the background, so it appears on its own.
 */
export function AutoRefresh({ active, everyMs = 4000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(timer);
  }, [active, everyMs, router]);
  return null;
}
