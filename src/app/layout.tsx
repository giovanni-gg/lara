import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";
import { BottomNav } from "@/components/bottom-nav";

const sans = Inter({
  variable: "--font-sans-stack",
  subsets: ["latin"],
});

// A serif for the words being learned — they should read like language, not UI.
const display = Fraunces({
  variable: "--font-display-stack",
  subsets: ["latin"],
  axes: ["SOFT", "WONK", "opsz"],
});

export const metadata: Metadata = {
  title: "Lara",
  description: "Flashcards and immersion reading, generated for your level.",
  applicationName: "Lara",
  appleWebApp: {
    capable: true,
    title: "Lara",
    statusBarStyle: "black-translucent",
  },
  manifest: "/manifest.webmanifest",
};

// Every screen reads this user's own decks, cards, and schedule — there is
// nothing here worth prerendering at build time.
export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Full-bleed under the notch when installed to the home screen.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0d10" },
    { media: "(prefers-color-scheme: light)", color: "#f7f5f1" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${display.variable} h-full antialiased`}
    >
      <body className="font-sans min-h-full flex flex-col">
        {/* Bottom nav is fixed, so reserve room for it. */}
        <main className="flex-1 pb-28">{children}</main>
        <BottomNav />
      </body>
    </html>
  );
}
