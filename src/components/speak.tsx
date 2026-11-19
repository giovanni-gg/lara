"use client";

import { useEffect, useRef, useState } from "react";
import {
  ConversationProvider,
  useConversation,
  useConversationClientTool,
  type HookOptions,
} from "@elevenlabs/react";
import { AudioLines, Loader2, Mic, MicOff, PhoneOff, RotateCcw } from "lucide-react";
import { Button, inputStyles } from "@/components/ui";
import { cn } from "@/lib/utils";
import { SHOW_CORRECTION_TOOL, type Correction, type SpeakOverrides } from "@/lib/speak/prompt";

/**
 * Speak: a voice conversation with the tutor agent over WebRTC.
 *
 *   pick  → choose a topic and/or a deck
 *   live  → connecting, then listening/speaking, with the transcript and
 *           correction cards as they come
 *   ended → the transcript stays, the conversation is saved
 */

const TOPICS = [
  "Your day",
  "Food & cooking",
  "Weekend plans",
  "Travel",
  "Family & friends",
  "Work & study",
  "Hobbies",
  "Shopping",
  "Home",
  "Films & series",
  "Weather",
  "Health",
];

export type SpeakDeckOption = { id: string; label: string; depth: number };

export type SpeakLearnerInfo = {
  /** "Swedish" */
  target: string;
  /** "English" */
  source: string;
  level: string;
};

type Item =
  | { id: number; kind: "user" | "agent"; text: string }
  | ({ id: number; kind: "correction" } & Correction);

/** An Item before it gets its id (Omit applied to each member of the union). */
type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;
type NewItem = WithoutId<Item>;

type Session = {
  conversationToken: string;
  conversationId: string | null;
  topic: string;
  deckId: string | null;
  overrides: SpeakOverrides;
};

type Phase = "pick" | "live" | "ended";

export function Speak(props: {
  decks: SpeakDeckOption[];
  learner: SpeakLearnerInfo;
}) {
  return (
    <ConversationProvider>
      <SpeakScreen {...props} />
    </ConversationProvider>
  );
}

function SpeakScreen({ decks, learner }: { decks: SpeakDeckOption[]; learner: SpeakLearnerInfo }) {
  const [phase, setPhase] = useState<Phase>("pick");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [topic, setTopic] = useState("");

  // The log lives in a ref too, so the disconnect handler saves every line
  // even if the last ones haven't rendered yet. Only touched in handlers.
  const log = useRef<Item[]>([]);
  const nextId = useRef(0);
  const session = useRef<Session | null>(null);
  const connected = useRef(false);

  const add = (item: NewItem) => {
    log.current = [...log.current, { ...item, id: nextId.current++ }];
    setItems(log.current);
  };

  const conversation = useConversation({
    onMessage: ({ message, role }) => {
      const text = message.trim();
      if (text) add({ kind: role === "user" ? "user" : "agent", text });
    },
    // Interrupted mid-sentence: keep only what was actually spoken.
    onAgentResponseCorrection: ({ original_agent_response, corrected_agent_response }) => {
      const index = log.current.findLastIndex(
        (item) => item.kind === "agent" && item.text === original_agent_response.trim(),
      );
      if (index < 0) return;
      const corrected = corrected_agent_response.trim();
      log.current = log.current
        .map((item, i) => (i === index && item.kind === "agent" ? { ...item, text: corrected } : item))
        .filter((item) => item.kind !== "agent" || item.text);
      setItems(log.current);
    },
    onConnect: () => {
      connected.current = true;
    },
    onError: (message) => {
      console.error("[speak]", message);
      // A failure before the call connected never reaches onDisconnect.
      if (!connected.current) {
        setError(`Couldn't connect: ${message}`);
        setPhase("ended");
      }
    },
    onDisconnect: (details) => {
      setPhase("ended");
      if (details.reason === "error") setError(`The call dropped: ${details.message}`);
      void save();
    },
  });

  useConversationClientTool(SHOW_CORRECTION_TOOL, (params: Record<string, unknown>) => {
    const field = (key: string) => (typeof params[key] === "string" ? (params[key] as string).trim() : "");
    const correction = { said: field("said"), better: field("better"), explanation: field("explanation") };
    if (correction.better) add({ kind: "correction", ...correction });
    return "ok";
  });

  async function save() {
    const current = session.current;
    session.current = null; // once per conversation
    if (!current) return;
    const transcript = log.current.flatMap((item) =>
      item.kind === "correction" ? [] : [{ role: item.kind, text: item.text }],
    );
    const corrections = log.current.flatMap((item) =>
      item.kind === "correction" ? [{ said: item.said || "…", better: item.better, explanation: item.explanation }] : [],
    );
    await fetch("/api/speak/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        externalId: current.conversationId,
        topic: current.topic,
        deckId: current.deckId,
        transcript,
        corrections,
      }),
    }).catch(() => {});
  }

  async function start(choice: { topic?: string; deckId?: string }) {
    if (starting) return;
    setStarting(true);
    setError(null);
    try {
      // Mic permission and the token in parallel: both are needed, neither waits on the other.
      const [data] = await Promise.all([requestSession(choice), ensureMicrophone()]);
      session.current = data;
      connected.current = false;
      log.current = [];
      setItems([]);
      setTopic(data.topic);
      setPhase("live");
      conversation.startSession({
        conversationToken: data.conversationToken,
        connectionType: "webrtc",
        overrides: data.overrides as HookOptions["overrides"],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the conversation");
    } finally {
      setStarting(false);
    }
  }

  function reset() {
    setPhase("pick");
    setError(null);
  }

  if (phase === "pick") {
    return <StartForm decks={decks} learner={learner} starting={starting} error={error} onStart={start} />;
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col overflow-hidden px-4 pt-safe">
        <header className="flex items-center justify-between gap-3 py-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-muted">
              {learner.target} · {learner.level}
            </p>
            <h1 className="truncate font-display text-lg font-semibold">{topic}</h1>
          </div>
        </header>

        <Transcript items={items} learner={learner} />

        {phase === "live" ? (
          <Controls
            status={conversation.status}
            speaking={conversation.isSpeaking}
            muted={conversation.isMuted}
            onMute={() => conversation.setMuted(!conversation.isMuted)}
            onEnd={() => conversation.endSession()}
          />
        ) : (
          <div className="space-y-2 pb-safe pt-3">
            {error ? <p className="text-center text-sm text-again">{error}</p> : null}
            <Button className="w-full min-h-12" onClick={reset}>
              <RotateCcw className="size-4" aria-hidden />
              New conversation
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

async function requestSession(choice: { topic?: string; deckId?: string }): Promise<Session> {
  let response: Response;
  try {
    response = await fetch("/api/speak/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(choice),
    });
  } catch {
    throw new Error("Couldn't reach the server");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "Couldn't start the conversation");
  return data as Session;
}

/** Asks for the microphone up front, so a refusal gets a clear message. */
async function ensureMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser can't use the microphone here. Open Lara over https, in Safari or Chrome.");
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // The SDK opens its own; this one was only for the permission.
    stream.getTracks().forEach((track) => track.stop());
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      throw new Error("Microphone access is off. Allow it for this site in your browser settings, then try again.");
    }
    if (name === "NotFoundError") throw new Error("No microphone found.");
    throw new Error("Couldn't open the microphone.");
  }
}

function StartForm({
  decks,
  learner,
  starting,
  error,
  onStart,
}: {
  decks: SpeakDeckOption[];
  learner: SpeakLearnerInfo;
  starting: boolean;
  error: string | null;
  onStart: (choice: { topic?: string; deckId?: string }) => void;
}) {
  const [topic, setTopic] = useState("");
  const [deckId, setDeckId] = useState("");
  const ready = Boolean(topic.trim() || deckId);

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) onStart({ topic: topic.trim() || undefined, deckId: deckId || undefined });
      }}
    >
      <div>
        <span className="mb-2 block text-sm font-medium">Talk about</span>
        <div className="flex flex-wrap gap-1.5">
          {TOPICS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={topic === option}
              onClick={() => setTopic(topic === option ? "" : option)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs transition-colors",
                topic === option
                  ? "border-accent/60 bg-accent/10 text-foreground"
                  : "border-line text-muted active:border-accent/60",
              )}
            >
              {option}
            </button>
          ))}
        </div>
        <input
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          maxLength={200}
          placeholder="…or anything you like"
          aria-label="Topic"
          className={cn(inputStyles, "mt-2")}
        />
      </div>

      {decks.length > 0 ? (
        <label className="block">
          <span className="mb-1 block text-sm font-medium">From a deck</span>
          <select value={deckId} onChange={(event) => setDeckId(event.target.value)} className={inputStyles}>
            <option value="">No deck</option>
            {decks.map((deck) => (
              <option key={deck.id} value={deck.id}>
                {"  ".repeat(deck.depth)}
                {deck.label}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-muted">
            {deckId ? "Lara weaves in words you've studied from it." : "Optional: practise a deck's words out loud."}
          </span>
        </label>
      ) : null}

      <Button type="submit" disabled={!ready || starting} className="w-full min-h-13">
        {starting ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Connecting…
          </>
        ) : (
          <>
            <Mic className="size-4" aria-hidden />
            Start talking
          </>
        )}
      </Button>
      {error ? <p className="text-sm text-again">{error}</p> : null}
      <p className="text-xs text-muted">
        Uses your microphone. Speak {learner.target}, and switch to {learner.source} whenever you&apos;re stuck —
        Lara explains, then carries on in {learner.target}.
      </p>
    </form>
  );
}

function Transcript({ items, learner }: { items: Item[]; learner: SpeakLearnerInfo }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items]);

  return (
    <div className="-mx-4 flex-1 overflow-y-auto px-4" aria-live="polite">
      {items.length === 0 ? (
        <p className="pt-10 text-center text-sm text-muted">
          Say hello in {learner.target} — or in {learner.source} if you&apos;d rather start there.
        </p>
      ) : null}
      <ul className="space-y-2 pb-3">
        {items.map((item) =>
          item.kind === "correction" ? (
            <li key={item.id}>
              <CorrectionCard correction={item} />
            </li>
          ) : (
            <li key={item.id} className={cn("flex", item.kind === "user" ? "justify-end" : "justify-start")}>
              <p
                className={cn(
                  "max-w-[85%] rounded-2xl px-3.5 py-2 text-[15px] leading-snug",
                  item.kind === "user"
                    ? "rounded-br-md bg-accent text-accent-ink"
                    : "rounded-bl-md border border-line bg-surface",
                )}
              >
                {item.text}
              </p>
            </li>
          ),
        )}
      </ul>
      <div ref={end} />
    </div>
  );
}

function CorrectionCard({ correction }: { correction: Correction }) {
  return (
    <div className="mx-auto max-w-[92%] rounded-xl border border-hard/40 bg-hard/10 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-hard">Better way to say it</p>
      {correction.said ? <p className="mt-1 text-sm text-muted line-through decoration-again/60">{correction.said}</p> : null}
      <p className="font-display text-base font-semibold text-good">{correction.better}</p>
      {correction.explanation ? <p className="mt-0.5 text-xs text-muted">{correction.explanation}</p> : null}
    </div>
  );
}

function Controls({
  status,
  speaking,
  muted,
  onMute,
  onEnd,
}: {
  status: string;
  speaking: boolean;
  muted: boolean;
  onMute: () => void;
  onEnd: () => void;
}) {
  const connecting = status !== "connected";
  const label = connecting
    ? "Connecting…"
    : muted
      ? "Muted — tap the mic to talk"
      : speaking
        ? "Lara is speaking — talk to interrupt"
        : "Listening…";

  return (
    <div className="border-t border-line pb-safe pt-3">
      <div className="flex items-center justify-between px-2">
        <button
          type="button"
          onClick={onMute}
          disabled={connecting}
          aria-pressed={muted}
          aria-label={muted ? "Unmute" : "Mute"}
          className={cn(
            "flex size-12 items-center justify-center rounded-full border transition-colors disabled:opacity-40",
            muted ? "border-again/50 bg-again/15 text-again" : "border-line bg-raised text-foreground",
          )}
        >
          {muted ? <MicOff className="size-5" aria-hidden /> : <Mic className="size-5" aria-hidden />}
        </button>

        <div className="relative flex size-20 items-center justify-center" aria-hidden>
          {!connecting && !muted ? (
            <span
              className={cn(
                "absolute inset-0 rounded-full bg-accent/25",
                speaking ? "motion-safe:animate-ping" : "motion-safe:animate-pulse",
              )}
            />
          ) : null}
          <span
            className={cn(
              "relative flex size-16 items-center justify-center rounded-full transition-colors",
              connecting || muted ? "bg-raised text-muted" : "bg-accent text-accent-ink",
            )}
          >
            {connecting ? (
              <Loader2 className="size-7 animate-spin" />
            ) : speaking ? (
              <AudioLines className="size-7" />
            ) : muted ? (
              <MicOff className="size-7" />
            ) : (
              <Mic className="size-7" />
            )}
          </span>
        </div>

        <button
          type="button"
          onClick={onEnd}
          aria-label="End conversation"
          className="flex size-12 items-center justify-center rounded-full border border-again/40 bg-again/15 text-again"
        >
          <PhoneOff className="size-5" aria-hidden />
        </button>
      </div>
      <p className="mt-2 text-center text-xs text-muted" role="status">
        {label}
      </p>
    </div>
  );
}
