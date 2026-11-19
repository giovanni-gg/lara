// Stand-in for `next/navigation` (its server-side half).
//
// The real `redirect()` / `notFound()` throw special errors Next catches
// upstream to send a 3xx / 404. Keeping the throw is right (the caller must
// not carry on), so these throw errors a test can recognise:
//
//   await expect(signIn(form)).rejects.toThrow(RedirectError);
//   await expect(signIn(form)).rejects.toMatchObject({ url: "/" });
//   await expect(somethingMissing()).rejects.toThrow(NotFoundError);

export class RedirectError extends Error {
  constructor(
    public readonly url: string,
    public readonly permanent = false,
  ) {
    super(`redirect(${url})`);
    this.name = "RedirectError";
  }
}

export class NotFoundError extends Error {
  constructor() {
    super("notFound()");
    this.name = "NotFoundError";
  }
}

export function redirect(url: string): never {
  throw new RedirectError(url);
}

export function permanentRedirect(url: string): never {
  throw new RedirectError(url, true);
}

export function notFound(): never {
  throw new NotFoundError();
}

export const RedirectType = { push: "push", replace: "replace" } as const;
