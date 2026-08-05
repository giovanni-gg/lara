"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Plays a generated audio clip. Kept as its own component so the same control
 * works on cards, article sentences, and the full-article player.
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
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!autoPlay || !src) return;
    // Safari blocks autoplay without a gesture; a rejected promise is fine.
    audioRef.current?.play().catch(() => {});
  }, [autoPlay, src]);

  if (!src) return null;

  const dimensions = {
    sm: "size-8",
    md: "size-11",
    lg: "size-14",
  }[size];

  const iconSize = { sm: "size-4", md: "size-5", lg: "size-6" }[size];

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          toggle();
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
      <audio
        ref={audioRef}
        src={src}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
    </>
  );
}
