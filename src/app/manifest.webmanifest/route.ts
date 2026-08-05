import { NextResponse } from "next/server";

/**
 * PWA manifest, so Lara installs to the iPhone home screen and opens without
 * Safari chrome. Icons are inline SVG data URIs — no binary assets to manage.
 */
const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#0b0d10"/><text x="256" y="336" font-size="260" text-anchor="middle" fill="#f2a33c" font-family="Georgia,serif">L</text></svg>`;

export function GET() {
  const icon = `data:image/svg+xml;base64,${Buffer.from(ICON).toString("base64")}`;

  return NextResponse.json(
    {
      name: "Lara",
      short_name: "Lara",
      description:
        "Flashcards and immersion reading, generated for your level.",
      start_url: "/",
      display: "standalone",
      orientation: "portrait",
      background_color: "#0b0d10",
      theme_color: "#0b0d10",
      icons: [
        { src: icon, sizes: "512x512", type: "image/svg+xml", purpose: "any" },
        {
          src: icon,
          sizes: "512x512",
          type: "image/svg+xml",
          purpose: "maskable",
        },
      ],
    },
    { headers: { "content-type": "application/manifest+json" } },
  );
}
