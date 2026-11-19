"use client";

import { useEffect, useId, useSyncExternalStore } from "react";
import { Pause, Volume2 } from "lucide-react";
import { noOwner, play, playingOwner, stop, subscribe } from "@/lib/audio-cache";
import { cn } from "@/lib/utils";

/**
 * Plays a generated audio clip. Kept as its own component so the same control
 * works on cards, article sentences, and the full-article player.
 *
 * Playback goes through `@/lib/audio-cache`: a clip someone prefetched starts
 * instantly from its decoded buffer, anything else streams as before. One clip
 * plays at a time app-wide.
 */
export function AudioButton({
  src,
  label = "Play audio",
  autoPlay = false,
  size = "md",
  className,
}: {
  src: string | null;
  label?: string;
  autoPlay?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const owner = useId();
  const playing = useSyncExternalStore(subscribe, playingOwner, noOwner) === owner;

  // Only ever starts a clip: flipping autoPlay off (a recognition card being
  // revealed) leaves the prompt audio running rather than cutting it off.
  useEffect(() => {
    if (!autoPlay || !src) return;
    // Without an unlocked context or a gesture, iOS refuses; the voice just
    // ends and the button stays tappable.
    play(src, owner);
  }, [autoPlay, src, owner]);

  // Unmounting (the card changed) or swapping clips silences this button's
  // sound — but never one another button has since started.
  useEffect(() => () => stop(owner), [src, owner]);

  if (!src) return null;

  const dimensions = {
    sm: "size-8",
    md: "size-11",
    lg: "size-14",
  }[size];

  const iconSize = { sm: "size-4", md: "size-5", lg: "size-6" }[size];

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        if (playing) stop(owner);
        else play(src, owner);
      }}
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border border-line bg-raised text-accent transition-colors active:bg-accent/15",
        dimensions,
        className,
      )}
    >
      {playing ? (
        <Pause className={iconSize} aria-hidden />
      ) : (
        <Volume2 className={iconSize} aria-hidden />
      )}
    </button>
  );
}
