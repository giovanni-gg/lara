"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, Loader2, MessageCircleQuestion, X } from "lucide-react";
import { suggestedQuestions } from "@/lib/tutor-prompts";
import { cn } from "@/lib/utils";

type Message = { id: string; role: "user" | "assistant"; content: string };

export type ChatCard = {
  id: string;
  target: string;
  source: string;
  notes?: string | null;
  targetSentence?: string | null;
};

/**
 * Ask-about-this-card, as a bottom sheet.
 *
 * A sheet rather than a separate screen because the point is to answer a
 * question and get back to the review — navigating away would lose the card and
 * the session position. Threads persist per card, so a conjugation table you
 * asked for in March is still there in June.
 *
 * Callers must pass `key={card.id}` so switching cards remounts this and clears
 * the thread, rather than resetting state from an effect.
 */
export function CardChat({
  card,
  open,
  onClose,
}: {
  card: ChatCard;
  open: boolean;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Load any prior thread for this card the first time the sheet opens.
  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(`/api/cards/${card.id}/chat`);
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) setMessages(data.messages ?? []);
      } catch {
        // An unreachable history endpoint shouldn't block asking a new question.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, loaded, card.id]);

  useEffect(() => {
    if (!open) return;
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, open]);

  // Escape closes, matching the swipe-down gesture on mobile.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const ask = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || streaming) return;

      setDraft("");
      setError(null);
      setStreaming(true);

      const userMessage: Message = {
        id: `local-${Date.now()}`,
        role: "user",
        content: trimmed,
      };
      const replyId = `reply-${Date.now()}`;
      setMessages((current) => [
        ...current,
        userMessage,
        { id: replyId, role: "assistant", content: "" },
      ]);

      try {
        const response = await fetch(`/api/cards/${card.id}/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ question: trimmed }),
        });

        if (!response.ok || !response.body) {
          const detail = await response.json().catch(() => null);
          setError(detail?.error ?? "Could not get an answer");
          setMessages((current) => current.filter((m) => m.id !== replyId));
          return;
        }

        // Plain text stream — append each chunk as it lands.
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let text = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
          setMessages((current) =>
            current.map((m) => (m.id === replyId ? { ...m, content: text } : m)),
          );
        }
      } catch {
        setError("Connection dropped mid-answer");
        setMessages((current) => current.filter((m) => m.id !== replyId));
      } finally {
        setStreaming(false);
      }
    },
    [card.id, streaming],
  );

  if (!open) return null;

  const suggestions = suggestedQuestions(card);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      <div
        role="dialog"
        aria-label={`Ask about ${card.target}`}
        className="relative flex max-h-[85dvh] flex-col rounded-t-3xl border-t border-line bg-surface pb-safe"
      >
        {/* Grabber + card being discussed */}
        <div className="shrink-0 px-4 pt-3">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
          <div className="flex items-start gap-3 pb-3">
            <div className="min-w-0 flex-1">
              <p className="font-display truncate text-lg font-semibold">
                {card.target}
              </p>
              <p className="truncate text-sm text-muted">{card.source}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-1 flex size-9 shrink-0 items-center justify-center rounded-full text-muted active:bg-raised"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
        </div>

        {/* Thread */}
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto border-t border-line px-4 py-4"
        >
          {messages.length === 0 ? (
            <div className="py-6 text-center">
              <MessageCircleQuestion
                className="mx-auto size-8 text-muted"
                aria-hidden
              />
              <p className="mt-3 text-sm text-muted">
                Ask anything about this card — conjugations, why a form is used,
                how a native would say it.
              </p>
            </div>
          ) : (
            <ul className="space-y-4">
              {messages.map((message) => (
                <li
                  key={message.id}
                  className={cn(
                    "flex",
                    message.role === "user" ? "justify-end" : "justify-start",
                  )}
                >
                  {message.role === "user" ? (
                    <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-accent/15 px-3.5 py-2.5 text-sm text-foreground">
                      {message.content}
                    </p>
                  ) : (
                    <div className="max-w-full min-w-0 text-sm leading-relaxed">
                      {message.content ? (
                        <TutorMarkdown content={message.content} />
                      ) : (
                        <Loader2
                          className="size-4 animate-spin text-muted"
                          aria-label="Thinking"
                        />
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {error ? <p className="mt-4 text-sm text-again">{error}</p> : null}
        </div>

        {/* Suggestions — only before the thread starts, to save vertical space */}
        {messages.length === 0 ? (
          <div className="no-scrollbar shrink-0 overflow-x-auto border-t border-line px-4 py-3">
            <div className="flex gap-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void ask(suggestion)}
                  className="shrink-0 rounded-full border border-line px-3 py-1.5 text-xs text-muted active:border-accent/60"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* Composer */}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void ask(draft);
          }}
          className="flex shrink-0 items-end gap-2 border-t border-line px-4 py-3"
        >
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void ask(draft);
              }
            }}
            rows={1}
            placeholder="Ask about this card…"
            aria-label="Your question"
            className="max-h-28 min-h-11 flex-1 resize-none rounded-xl border border-line bg-raised px-3 py-2.5 text-base outline-none placeholder:text-muted/70 focus:border-accent"
          />
          <button
            type="submit"
            disabled={!draft.trim() || streaming}
            aria-label="Send"
            className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-ink disabled:opacity-40"
          >
            {streaming ? (
              <Loader2 className="size-5 animate-spin" aria-hidden />
            ) : (
              <ArrowUp className="size-5" aria-hidden />
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

/**
 * Tutor answers are markdown because conjugation tables are the single most
 * useful thing it produces, and those need real table layout.
 */
function TutorMarkdown({ content }: { content: string }) {
  return (
    <div className="space-y-2.5">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="leading-relaxed">{children}</p>,
          strong: ({ children }) => (
            <strong className="font-semibold text-accent">{children}</strong>
          ),
          em: ({ children }) => (
            <em className="font-display italic">{children}</em>
          ),
          code: ({ children }) => (
            <code className="rounded bg-raised px-1.5 py-0.5 font-display text-[0.95em]">
              {children}
            </code>
          ),
          ul: ({ children }) => (
            <ul className="list-disc space-y-1 pl-5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal space-y-1 pl-5">{children}</ol>
          ),
          // Tables scroll inside their own box so a wide paradigm never makes
          // the sheet scroll sideways.
          table: ({ children }) => (
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full border-collapse text-left text-[13px]">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-line px-2 py-1.5 font-medium text-muted">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-line/50 px-2 py-1.5">{children}</td>
          ),
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}
