// Renders public/og-image.png, the picture shown when a link to LaraMig is shared.
//
//   npx tsx scripts/og-image.tsx
//
// A static file rather than an `opengraph-image.tsx` route on purpose: the
// proxy gates every path except root-level images, so a generated route would
// answer crawlers with the login redirect. Re-run after changing the copy.

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

const OUT = join(process.cwd(), "public", "og-image.png");

// The app's own dark theme (src/app/globals.css).
const C = {
  background: "#0b0d10",
  surface: "#14171c",
  raised: "#1c2027",
  border: "#262b34",
  foreground: "#eef1f5",
  muted: "#939cab",
  accent: "#f2a33c",
  again: "#f0654a",
  hard: "#d19a3f",
  good: "#4ea87a",
  easy: "#4a9ee0",
};

/** A static TTF from Google Fonts (an old user agent gets TTF, which Satori reads). */
async function googleFont(family: string, weight: number): Promise<ArrayBuffer> {
  const css = await fetch(
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}`,
    { headers: { "User-Agent": "Mozilla/4.0" } },
  ).then((r) => r.text());
  const url = css.match(/src: url\((.+?)\) format\('(?:truetype|opentype)'\)/)?.[1];
  if (!url) throw new Error(`No TTF for ${family} ${weight}`);
  return fetch(url).then((r) => r.arrayBuffer());
}

const RATINGS = [
  { label: "Again", interval: "10m", color: C.again },
  { label: "Hard", interval: "1d", color: C.hard },
  { label: "Good", interval: "3d", color: C.good },
  { label: "Easy", interval: "8d", color: C.easy },
];

async function main() {
  const [fraunces, inter, interMedium] = await Promise.all([
    googleFont("Fraunces", 600),
    googleFont("Inter", 400),
    googleFont("Inter", 500),
  ]);

  const image = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: C.background,
          color: C.foreground,
          fontFamily: "Inter",
          padding: "64px 72px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", flex: 1, paddingRight: 56 }}>
          <div style={{ fontFamily: "Fraunces", fontSize: 44 }}>LaraMig</div>
          <div
            style={{
              display: "flex",
              marginTop: 54,
              fontFamily: "Fraunces",
              fontSize: 66,
              lineHeight: 1.04,
              letterSpacing: -1.5,
            }}
          >
            See each word again just before you&rsquo;d forget it.
          </div>
          <div style={{ display: "flex", marginTop: "auto", fontSize: 26, color: C.muted, lineHeight: 1.35 }}>
            A language-learning app by Giovanni Guerreiro, built on spaced repetition.
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", width: 360, justifyContent: "center" }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              height: 340,
              borderRadius: 30,
              border: `2px solid ${C.border}`,
              background: C.surface,
              padding: 26,
            }}
          >
            <div style={{ fontSize: 20, color: C.muted }}>Swedish</div>
            <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center" }}>
              <div style={{ fontFamily: "Fraunces", fontSize: 84, letterSpacing: -2 }}>äpple</div>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                fontSize: 30,
                fontWeight: 500,
                paddingTop: 18,
                borderTop: `2px solid ${C.border}`,
              }}
            >
              apple
            </div>
          </div>
          <div style={{ display: "flex", marginTop: 20, gap: 10 }}>
            {RATINGS.map((r) => (
              <div
                key={r.label}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  flex: 1,
                  padding: "10px 0",
                  borderRadius: 14,
                  border: `2px solid ${r.color}66`,
                  background: `${r.color}26`,
                  color: r.color,
                  fontSize: 20,
                  fontWeight: 500,
                }}
              >
                {r.label}
                <span style={{ fontSize: 15, fontWeight: 400, opacity: 0.75 }}>{r.interval}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Fraunces", data: fraunces, weight: 600, style: "normal" },
        { name: "Inter", data: inter, weight: 400, style: "normal" },
        { name: "Inter", data: interMedium, weight: 500, style: "normal" },
      ],
    },
  );

  await writeFile(OUT, Buffer.from(await image.arrayBuffer()));
  console.log(`Wrote ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
