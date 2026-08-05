"use client";

import { useState } from "react";
import { MessageCircleQuestion } from "lucide-react";
import { CardChat, type ChatCard } from "@/components/card-chat";

/**
 * Opens the tutor sheet from a server-rendered list. Exists so the deck listing
 * can stay a server component and only this button ships client JS.
 */
export function CardChatButton({ card }: { card: ChatCard }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-muted active:border-accent/60"
      >
        <MessageCircleQuestion className="size-3.5" aria-hidden />
        Ask
      </button>
      <CardChat
        key={card.id}
        card={card}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
