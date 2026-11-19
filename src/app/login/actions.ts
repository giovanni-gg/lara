"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  AUTH_COOKIE,
  AUTH_COOKIE_MAX_AGE,
  checkPassword,
  gateState,
  safeNext,
  sessionToken,
} from "@/lib/auth";

export async function signIn(formData: FormData) {
  const next = safeNext(formData.get("next"));
  const gate = gateState();
  if (gate.mode === "misconfigured") {
    throw new Error("LARA_PASSWORD is not configured");
  }
  if (gate.mode === "open") redirect(next);

  const attempt = String(formData.get("password") ?? "");
  if (!(await checkPassword(attempt))) {
    redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  }

  (await cookies()).set(AUTH_COOKIE, await sessionToken(gate.password), {
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
