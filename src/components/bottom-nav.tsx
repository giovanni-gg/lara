"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookHeadphones, Layers, Mic, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

// Decks is home ("/" redirects there). Four tabs leave room for full labels.
const TABS = [
  { href: "/decks", label: "Decks", icon: Layers },
  { href: "/articles", label: "Listen & Read", icon: BookHeadphones },
  { href: "/speak", label: "Speak", icon: Mic },
  { href: "/settings", label: "You", icon: Settings },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  // The study screen wants the whole display; the login screen has nowhere to go.
  if (pathname.startsWith("/study") || pathname === "/login") return null;

  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-line bg-surface/95 backdrop-blur-lg pb-safe">
      <ul className="mx-auto flex max-w-md">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors",
                  active ? "text-accent" : "text-muted hover:text-foreground",
                )}
              >
                <Icon
                  className="size-6"
                  strokeWidth={active ? 2.4 : 1.8}
                  aria-hidden
                />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
