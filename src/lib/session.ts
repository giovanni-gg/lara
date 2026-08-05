import { prisma } from "./db";

/**
 * Single-user for now: every request resolves to one local account, created on
 * first use. When real auth lands (Clerk via the Vercel Marketplace, or
 * NextAuth), this is the only function that has to change — nothing else in the
 * app reads the user identity directly.
 */

const LOCAL_EMAIL = process.env.LARA_USER_EMAIL ?? "you@lara.local";

export async function getCurrentUser() {
  // Upsert rather than find-then-create: concurrent requests would otherwise
  // race on the unique email.
  return prisma.user.upsert({
    where: { email: LOCAL_EMAIL },
    update: {},
    create: { email: LOCAL_EMAIL, name: "You" },
  });
}

/** The profile the app is currently studying, plus every profile for switching. */
export async function getActiveProfile() {
  const user = await getCurrentUser();

  const profiles = await prisma.languageProfile.findMany({
    where: { userId: user.id },
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
  });

  return {
    user,
    profiles,
    active: profiles.find((p) => p.isActive) ?? profiles[0] ?? null,
  };
}

export async function requireActiveProfile() {
  const { user, active } = await getActiveProfile();
  if (!active) {
    throw new Error("No language profile yet — create one first.");
  }
  return { user, profile: active };
}
