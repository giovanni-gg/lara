"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Mic, Square } from "lucide-react";
import { clearAboutYou, saveAboutYou } from "@/app/actions";
import { Button, Panel, inputStyles } from "@/components/ui";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { MAX_ABOUT_CHARS } from "@/lib/learner-context";
import { MAX_AUDIO_BYTES, MAX_RECORDING_SECONDS } from "@/lib/stt";
import { cn } from "@/lib/utils";

/** Recorder formats in order of preference; Safari (iOS too) only does audio/mp4. */
const MIME_TYPES = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"];
/** ~1.5 MB for three minutes: well under the upload cap. Browsers may round it. */
const BITS_PER_SECOND = 64_000;

const extensionFor = (type: string) =>
  type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : type.includes("webm") ? "webm" : "audio";

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** Adds a piece of text on a new line, within the cap. */
const append = (text: string, addition: string) =>
  (text.trim() ? `${text.trimEnd()}\n${addition}` : addition).slice(0, MAX_ABOUT_CHARS);

type Phase = "idle" | "recording" | "transcribing";

export function AboutYou({
  about,
  known,
  summarised,
  language,
}: {
  /** What the learner saved, as they wrote it. */
  about: string | null;
  /** What the prompts get (`learnerContext`): the summary, else the trimmed text. */
  known: string | null;
  /** Whether `known` is the distilled summary, not the raw fallback. */
  summarised: boolean;
  /** The target language's name, for the prompts. */
  language: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(about ?? "");
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const textarea = useRef<HTMLTextAreaElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const ticker = useRef<number | null>(null);

  const stopTicker = () => {
    if (ticker.current !== null) window.clearInterval(ticker.current);
    ticker.current = null;
  };
  const releaseMic = () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  };

  // Leaving the page mid-recording: drop the clip and free the microphone.
  useEffect(
    () => () => {
      stopTicker();
      if (recorder.current && recorder.current.state !== "inactive") {
        recorder.current.onstop = null;
        recorder.current.stop();
      }
      releaseMic();
    },
    [],
  );

  const prompts = [
    { label: "Why you're learning", starter: `I'm learning ${language} because ` },
    { label: "Where you live", starter: "I live in " },
    { label: "Your work", starter: "I work as " },
    { label: "Family & friends", starter: "I live with " },
    { label: "Hobbies", starter: "In my free time I " },
    { label: "Coming up", starter: "Soon I'm going to " },
  ];

  function addStarter(starter: string) {
    setText((current) => append(current, starter));
    // After React has rendered the new text: put the cursor at its end.
    requestAnimationFrame(() => {
      const el = textarea.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }

  async function startRecording() {
    setError(null);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Voice input doesn't work in this browser. You can type instead.");
      return;
    }
    let mic: MediaStream;
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Microphone access was refused. You can type instead.");
      return;
    }
    const preferred = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(mic, {
        ...(preferred ? { mimeType: preferred } : {}),
        audioBitsPerSecond: BITS_PER_SECOND,
      });
    } catch {
      mic.getTracks().forEach((track) => track.stop());
      setError("Couldn't start recording. You can type instead.");
      return;
    }

    stream.current = mic;
    recorder.current = rec;
    chunks.current = [];
    rec.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.current.push(event.data);
    };
    rec.onstop = () => {
      stopTicker();
      releaseMic();
      const type = rec.mimeType || preferred || "audio/mp4";
      void upload(new Blob(chunks.current, { type }));
    };

    const started = Date.now();
    setSeconds(0);
    setPhase("recording");
    rec.start();
    ticker.current = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - started) / 1000);
      setSeconds(elapsed);
      if (elapsed >= MAX_RECORDING_SECONDS) stopRecording();
    }, 250);
  }

  function stopRecording() {
    stopTicker();
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
  }

  async function upload(clip: Blob) {
    if (clip.size === 0) {
      setError("Nothing was recorded. Try again.");
      setPhase("idle");
      return;
    }
    if (clip.size > MAX_AUDIO_BYTES) {
      setError("That recording is too long. Keep it under three minutes.");
      setPhase("idle");
      return;
    }
    setPhase("transcribing");
    try {
      const body = new FormData();
      const type = clip.type.split(";")[0];
      body.append("audio", clip, `about.${extensionFor(type)}`);
      const response = await fetch("/api/transcribe", { method: "POST", body });
      const data = (await response.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!response.ok) setError(data.error ?? "Couldn't transcribe that. Try again, or type instead.");
      else if (!data.text?.trim()) setError("Didn't catch anything. Try again a little closer to the mic.");
      else setText((current) => append(current, data.text!.trim()));
    } catch {
      setError("Couldn't reach the server. Try again, or type instead.");
    }
    setPhase("idle");
  }

  async function save(formData: FormData) {
    setError(null);
    try {
      await saveAboutYou(formData);
      setEditing(false);
    } catch {
      setError("Couldn't save. Try again.");
    }
  }

  async function clear() {
    setError(null);
    try {
      await clearAboutYou();
      setText("");
      setEditing(false);
    } catch {
      setError("Couldn't clear it. Try again.");
    }
  }

  const saved = Boolean(about?.trim());

  if (saved && !editing) {
    return (
      <Panel className="space-y-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">What LaraMig knows about you</p>
          <p className="mt-1 text-sm whitespace-pre-line">{known}</p>
          {!summarised ? (
            <p className="mt-1.5 text-xs text-muted">
              Saved as you wrote it: it couldn&apos;t be summarised just now. Edit and save again to retry.
            </p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setText(about ?? "");
              setEditing(true);
            }}
          >
            Edit
          </Button>
          <form action={clear}>
            <ConfirmSubmit variant="ghost" size="sm" message="Forget everything you told LaraMig about yourself?">
              Clear
            </ConfirmSubmit>
          </form>
        </div>
        {error ? <p className="text-xs text-again">{error}</p> : null}
      </Panel>
    );
  }

  const busy = phase !== "idle";

  return (
    <form action={save} className="space-y-2">
      <p className="text-xs text-muted">
        Tell LaraMig about yourself so cards, stories and conversations are about your life.
      </p>
      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {prompts.map((prompt) => (
          <button
            key={prompt.label}
            type="button"
            onClick={() => addStarter(prompt.starter)}
            className="shrink-0 rounded-full border border-line px-3 py-1.5 text-xs text-muted active:border-accent/60"
          >
            {prompt.label}
          </button>
        ))}
      </div>
      <textarea
        ref={textarea}
        name="about"
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={5}
        maxLength={MAX_ABOUT_CHARS}
        placeholder="e.g. Moving to Stockholm with my girlfriend in spring. I work in data engineering and run marathons."
        className={`${inputStyles} resize-y text-sm`}
        aria-label="About you"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={phase === "recording" ? stopRecording : startRecording}
          disabled={phase === "transcribing"}
          aria-label={phase === "recording" ? "Stop recording" : "Speak instead of typing"}
          className={cn(
            "inline-flex size-9 shrink-0 items-center justify-center rounded-full border transition-colors disabled:opacity-50",
            phase === "recording"
              ? "animate-pulse border-again/60 bg-again/15 text-again"
              : "border-line bg-raised text-foreground active:border-accent/60",
          )}
        >
          {phase === "recording" ? (
            <Square className="size-3.5" fill="currentColor" aria-hidden />
          ) : phase === "transcribing" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Mic className="size-4" aria-hidden />
          )}
        </button>
        <p className="min-w-0 flex-1 text-xs text-muted" aria-live="polite">
          {phase === "recording"
            ? `Recording ${clock(seconds)} / ${clock(MAX_RECORDING_SECONDS)}. Tap to stop.`
            : phase === "transcribing"
              ? "Transcribing…"
              : "Speak in any language, or type."}
        </p>
        <span className="shrink-0 text-[11px] tabular-nums text-muted">
          {text.length}/{MAX_ABOUT_CHARS}
        </span>
      </div>
      {error ? <p className="text-xs text-again">{error}</p> : null}
      <div className="flex gap-2">
        <SaveButton disabled={busy || (!text.trim() && !saved)} />
        {saved ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setText(about ?? "");
              setError(null);
              setEditing(false);
            }}
            disabled={busy}
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function SaveButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="flex-1" disabled={disabled || pending}>
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden /> Saving…
        </>
      ) : (
        "Save"
      )}
    </Button>
  );
}
