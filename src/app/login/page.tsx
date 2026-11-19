import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, isValidSession, safeNext } from "@/lib/auth";
import { Button, Field, Screen, inputStyles } from "@/components/ui";
import { signIn } from "./actions";

export const metadata = { title: "Sign in · Lara" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next: rawNext, error } = await searchParams;
  const next = safeNext(rawNext);

  // Already in (or the gate is off locally): nothing to do here.
  if (await isValidSession((await cookies()).get(AUTH_COOKIE)?.value)) {
    redirect(next);
  }

  return (
    <Screen className="flex min-h-[80dvh] flex-col justify-center">
      <h1 className="mb-1 text-center font-display text-4xl font-semibold tracking-tight">
        Lara
      </h1>
      <p className="mb-8 text-center text-sm text-muted">
        Enter the password to continue.
      </p>

      <form action={signIn} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        {/* Fixed username so the browser's password manager can save the pair. */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          value="lara"
          readOnly
          tabIndex={-1}
          aria-hidden
          className="sr-only"
        />
        <Field label="Password">
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            autoFocus
            aria-invalid={error ? true : undefined}
            className={inputStyles}
          />
        </Field>
        {error ? (
          <p role="alert" className="text-sm text-again">
            That password didn&apos;t work.
          </p>
        ) : null}
        <Button type="submit" className="w-full">
          Sign in
        </Button>
      </form>
    </Screen>
  );
}
