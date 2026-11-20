import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, isValidSession, safeNext } from "@/lib/auth";
import { focusPasswordOnLoad, requestOrigin } from "@/lib/landing";
import { SCHEDULER_SETTINGS } from "@/lib/srs";
import { ForgettingCurve } from "@/components/forgetting-curve";
import { ActivityStrip, CardFaces, HeroCard, SpeakCorrection, StorySnippet } from "./illustrations";
import { SignInForm } from "./sign-in-form";

// The logged-out face of LaraMig: every gated URL lands here, so it doubles as
// the landing page for the domain. Sign-in stays at the top for the people
// who have a password; the rest explains what LaraMig is to everyone else.

const TITLE = "LaraMig: learn languages with spaced repetition";
const DESCRIPTION =
  "A language-learning app by Giovanni Guerreiro, built on spaced repetition: AI-written flashcard decks, natural audio, stories at your level and a voice tutor. Invitation-only.";
const RETENTION = SCHEDULER_SETTINGS.desiredRetention;
const RETENTION_PERCENT = Math.round(RETENTION * 100);
const PORTFOLIO = "https://giovanniguerreiro.com";

export async function generateMetadata(): Promise<Metadata> {
  // Absolute share URLs on whichever domain the link was shared from.
  const origin = requestOrigin(await headers());
  const image = { url: "/og-image.png", width: 1200, height: 630, alt: "LaraMig: a flashcard reading äpple" };
  return {
    metadataBase: new URL(origin),
    title: TITLE,
    description: DESCRIPTION,
    openGraph: {
      type: "website",
      url: "/",
      siteName: "LaraMig",
      title: TITLE,
      description: DESCRIPTION,
      images: [image],
    },
    twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: [image] },
  };
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next: rawNext, error } = await searchParams;
  const next = safeNext(rawNext);

  // Already in (or the gate is off locally): nothing to do here.
  if (await isValidSession((await cookies()).get(AUTH_COOKIE)?.value)) {
    redirect(next);
  }

  return (
    // -mb-28 cancels the root layout's room for the bottom nav, which /login hides.
    <div className="-mb-28 overflow-x-clip pt-safe">
      <header className="mx-auto flex max-w-6xl flex-col gap-4 px-4 pt-4 sm:flex-row sm:items-end sm:justify-between sm:px-6 lg:px-10 lg:pt-6">
        <span className="font-display text-[28px] leading-none font-semibold tracking-tight sm:pb-3">LaraMig</span>
        <SignInForm next={next} error={Boolean(error)} autoFocus={focusPasswordOnLoad(next, error)} />
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-12 pb-16 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16 lg:px-10 lg:pt-14 lg:pb-24">
        <div>
          <h1 className="landing-rise max-w-[15ch] font-display text-[clamp(2.5rem,7vw,4.5rem)] leading-[1.02] font-semibold tracking-tight text-balance [font-variation-settings:'SOFT'_50]">
            See each word again just before you&rsquo;d forget it.
          </h1>
          <p className="landing-rise mt-6 max-w-[34rem] text-lg leading-relaxed text-pretty [--rise-delay:90ms]">
            LaraMig is a language-learning app by Giovanni Guerreiro, built on spaced repetition so you
            learn a language fast and keep what you learn.
          </p>
          <p className="landing-rise mt-3 max-w-[34rem] text-[15px] leading-relaxed text-muted text-pretty [--rise-delay:180ms]">
            It&rsquo;s invitation-only: a personal project with a handful of learners, so there&rsquo;s
            no public sign-up.
          </p>
          <nav className="landing-rise mt-7 flex flex-wrap gap-x-6 gap-y-2 text-[15px] font-medium [--rise-delay:240ms]">
            <a href="#how" className="text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent">
              How it works
            </a>
            <a href="#features" className="text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent">
              What&rsquo;s in it
            </a>
            <a href="#built" className="text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent">
              How it&rsquo;s built
            </a>
          </nav>
        </div>
        <div className="landing-rise [--rise-delay:200ms]">
          <HeroCard />
        </div>
      </section>

      <Band id="how">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center lg:gap-16">
          <div>
            <SectionTitle>You forget on a curve</SectionTitle>
            <div className="mt-4 max-w-[36rem] space-y-5 text-[16px] leading-relaxed text-pretty">
              <p>
                New words fade fast at first, then more slowly. Hermann Ebbinghaus measured it on
                himself in the 1880s, and it still holds.
              </p>
              <Idea term="A review at the right moment">
                Recall a word just as it starts to slip and it fades more slowly next time, so the
                gaps between reviews can grow: a day, a few days, weeks, months.
              </Idea>
              <Idea term="FSRS picks the moment">
                LaraMig schedules every card with FSRS, the open-source algorithm behind Anki&rsquo;s
                modern scheduler. It models how well you know each card and brings it back when
                you&rsquo;d have about an {RETENTION_PERCENT}% chance of recalling it.
              </Idea>
            </div>
          </div>
          <figure className="landing-curve rounded-2xl border border-line bg-surface px-3 pt-5 pb-3 shadow-sm sm:px-5">
            <ForgettingCurve retention={RETENTION} />
            <figcaption className="mt-2 px-1 text-[13px] leading-snug text-muted">
              An illustration, not real data. Each dot is a review: it lifts the memory back up,
              and the next fall is slower.
            </figcaption>
          </figure>
        </div>
      </Band>

      <Band id="features">
        <SectionTitle>What&rsquo;s in it</SectionTitle>
        <p className="mt-3 max-w-[36rem] text-[16px] leading-relaxed text-muted text-pretty">
          Three parts that feed each other: learn the words, use them, and watch them stick.
        </p>

        <div className="mt-10 grid gap-12 md:grid-cols-2 lg:grid-cols-3 lg:gap-10">
          <FeatureGroup title="Learn the words" plate={<CardFaces />}>
            <Feature term="Decks written for you">
              Describe what you want to learn and Claude writes the cards, with example sentences.
              Adding to a deck you already have, it reads the cards in it first, so the new ones
              match its style and don&rsquo;t repeat it.
            </Feature>
            <Feature term="Three ways to face a card">
              Swedish first to read it, English first to say it, or a picture first to skip
              translating. Pictures are drawn for each card by Gemini.
            </Feature>
            <Feature term="Natural audio">
              Every word and example sentence is read aloud by a natural ElevenLabs voice.
            </Feature>
            <Feature term="A tutor on every card">
              Ask about a conjugation or a false friend mid-review, without leaving the session.
            </Feature>
          </FeatureGroup>

          <FeatureGroup title="Use them" plate={<StorySnippet />}>
            <Feature term="Listen & Read">
              Short stories written from your own decks, one level above yours, with a few new words
              mixed in. Each sentence is read aloud; tap one to hear it again and see its
              translation.
            </Feature>
            <Feature term="Speak">
              A real-time voice conversation with a tutor in the language you&rsquo;re learning.
              Drop into your own language when you&rsquo;re stuck, and the mistakes worth fixing show up as
              corrections while you talk.
            </Feature>
            <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
              <SpeakCorrection />
            </div>
          </FeatureGroup>

          <FeatureGroup title="See them stick" plate={<ActivityStrip />}>
            <Feature term="Progress">
              Your streak, the words you know for good, a calendar of every day you studied,
              retention against the {RETENTION_PERCENT}% target, and the reviews coming up.
            </Feature>
            <Feature term="A few new cards a day">
              Each deck brings in five new cards a day unless you change it. Reviews are never
              capped, so nothing you&rsquo;ve learned slips through.
            </Feature>
            <Feature term="Made for the phone">
              Installs to the home screen and runs full screen. Ten minutes a day is the whole
              habit.
            </Feature>
          </FeatureGroup>
        </div>
      </Band>

      <Band id="built">
        <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <div>
            <SectionTitle>How it&rsquo;s built</SectionTitle>
            <p className="mt-3 max-w-[30rem] text-[16px] leading-relaxed text-muted text-pretty">
              Designed and built end to end by Giovanni Guerreiro: a working app with real learners,
              not a demo.
            </p>
          </div>
          <dl className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
            <Stack name="Next.js and React">The app, server-rendered and hosted on Vercel.</Stack>
            <Stack name="Postgres on Neon">Decks, cards and every review, through Prisma.</Stack>
            <Stack name="Claude">Writes the decks and the stories, and answers the card tutor&rsquo;s questions.</Stack>
            <Stack name="ElevenLabs">The voices on cards and stories, and the live conversation in Speak.</Stack>
            <Stack name="Gemini">Draws the pictures for picture-first cards.</Stack>
            <Stack name="FSRS">Schedules every review, through <span className="whitespace-nowrap">ts-fsrs</span>.</Stack>
          </dl>
        </div>
      </Band>

      <footer className="mx-auto mt-4 flex max-w-6xl flex-col gap-3 border-t border-line px-4 py-8 text-[15px] sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-10">
        <p>
          Built by{" "}
          <a
            href={PORTFOLIO}
            className="font-medium underline decoration-line underline-offset-4 hover:decoration-accent"
          >
            Giovanni Guerreiro
          </a>
        </p>
        <a href="#sign-in" className="text-muted underline decoration-line underline-offset-4 hover:text-foreground">
          Have an invite? Sign in
        </a>
      </footer>
    </div>
  );
}

/** A full-width section of the landing page. */
function Band({ id, children }: { id: string; children: ReactNode }) {
  return (
    <section id={id} className="mx-auto max-w-6xl scroll-mt-6 px-4 py-14 sm:px-6 lg:px-10 lg:py-20">
      {children}
    </section>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="font-display text-[clamp(1.75rem,4vw,2.5rem)] leading-[1.1] font-semibold tracking-tight text-balance">
      {children}
    </h2>
  );
}

function Idea({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="border-l-2 border-accent/60 pl-4">
      <h3 className="font-semibold">{term}</h3>
      <p className="mt-1 text-muted">{children}</p>
    </div>
  );
}

function FeatureGroup({ title, plate, children }: { title: string; plate: ReactNode; children: ReactNode }) {
  return (
    <div>
      <h3 className="font-display text-2xl font-semibold tracking-tight">{title}</h3>
      <div className="mt-4 rounded-2xl border border-line bg-surface p-4 shadow-sm">{plate}</div>
      <div className="mt-6 space-y-5">{children}</div>
    </div>
  );
}

function Feature({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="max-w-[36rem]">
      <h4 className="font-semibold">{term}</h4>
      <p className="mt-1 text-[15px] leading-relaxed text-muted text-pretty">{children}</p>
    </div>
  );
}

function Stack({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="border-t border-line pt-3">
      <dt className="font-semibold">{name}</dt>
      <dd className="mt-1 text-[15px] leading-relaxed text-muted">{children}</dd>
    </div>
  );
}
