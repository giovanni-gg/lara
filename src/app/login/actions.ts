"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  AUTH_COOKIE,
  AUTH_COOKIE_MAX_AGE,
  accountForPassword,
  gateState,
  safeNext,
  sessionToken,
} from "@/lib/auth";

export async function signIn(formData: FormData) {
  const next = safeNext(formData.get("next"));
  const gate = gateState();
  if (gate.mode === "misconfigured") {
    throw new Error("LARA_ACCOUNTS (or LARA_PASSWORD) is not configured");
  }
  if (gate.mode === "open") redirect(next);

  // The password alone picks the account — there is no username.
  const account = await accountForPassword(String(formData.get("password") ?? ""));
  if (!account) {
    redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  }

  (await cookies()).set(AUTH_COOKIE, await sessionToken(account), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: AUTH_COOKIE_MAX_AGE,
  });
  redirect(next);
}

export async function signOut() {
  (await cookies()).delete(AUTH_COOKIE);
  redirect("/login");
}
