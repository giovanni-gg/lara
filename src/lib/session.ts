import { cookies } from "next/headers";
import { prisma } from "./db";
import { AUTH_COOKIE, sessionEmail } from "./auth";

/**
 * Who is using the app. The signed session cookie (see `auth.ts`) names the
 * account; each account is one User row, created on first sign-in. With the
 * gate off in local dev, every request is the default account.
 *
 * This is the only place that resolves the user — everything else takes the
 * User (or its profile) from here, and every query is scoped by its id.
 */
export async function getCurrentUser() {
  const email = await sessionEmail((await cookies()).get(AUTH_COOKIE)?.value);
  // proxy.ts already turned away requests without a valid session; reaching
  // here without one means a route skipped the gate.
  if (!email) throw new Error("Not signed in");

  // Upsert rather than find-then-create: concurrent requests would otherwise
  // race on the unique email.
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: nameFor(email) },
  });
}

/** "ebba@lara.local" → "Ebba"; the default account is "You". */
function nameFor(email: string): string {
  const local = email.split("@")[0] ?? "";
  if (!local || local === "you") return "You";
  return local.charAt(0).toUpperCase() + local.slice(1);
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
