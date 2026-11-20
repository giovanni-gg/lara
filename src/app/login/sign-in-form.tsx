import { Button, inputStyles } from "@/components/ui";
import { cn } from "@/lib/utils";
import { signIn } from "./actions";

/** The password form, compact enough to sit in the landing page's header. */
export function SignInForm({
  next,
  error,
  autoFocus,
}: {
  next: string;
  error: boolean;
  autoFocus: boolean;
}) {
  return (
    <form
      id="sign-in"
      action={signIn}
      className="w-full scroll-mt-4 rounded-2xl border border-line bg-surface p-3 shadow-sm sm:w-auto"
    >
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
      <label htmlFor="password" className="mb-1.5 block px-0.5 text-[13px] font-medium">
        Have an invite? Enter your password.
      </label>
      <div className="flex gap-2">
        <input
          id="password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          autoFocus={autoFocus}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "sign-in-error" : undefined}
          className={cn(inputStyles, "min-h-11 min-w-0 flex-1 sm:w-56 sm:flex-none")}
        />
        <Button type="submit" className="shrink-0">
          Sign in
        </Button>
      </div>
      {error ? (
        <p id="sign-in-error" role="alert" className="mt-1.5 px-0.5 text-sm text-again">
          That password didn&apos;t work.
        </p>
      ) : null}
    </form>
  );
}
