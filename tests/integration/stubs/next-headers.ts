// Stand-in for `next/headers`.
//
// The real `headers()` / `cookies()` read the in-flight HTTP request and throw
// when there isn't one. Tests have no request, so this holds a small mutable
// store instead: an action can `(await cookies()).set(...)` (the login action
// does) and the test reads it back with `getCookie`. setup.ts calls
// `resetRequest()` before every test.

type CookieOptions = Record<string, unknown>;

const headerStore = new Map<string, string>();
const cookieStore = new Map<string, { value: string; options: CookieOptions }>();

export async function headers() {
  return {
    get: (name: string) => headerStore.get(name.toLowerCase()) ?? null,
    has: (name: string) => headerStore.has(name.toLowerCase()),
    entries: () => headerStore.entries(),
  };
}

export async function cookies() {
  return {
    get: (name: string) => {
      const cookie = cookieStore.get(name);
      return cookie === undefined ? undefined : { name, value: cookie.value };
    },
    getAll: () => [...cookieStore].map(([name, { value }]) => ({ name, value })),
    has: (name: string) => cookieStore.has(name),
    set: (
      nameOrCookie: string | ({ name: string; value: string } & CookieOptions),
      value?: string,
      options: CookieOptions = {},
    ) => {
      if (typeof nameOrCookie === "string") {
        cookieStore.set(nameOrCookie, { value: value ?? "", options });
      } else {
        const { name, value: v, ...rest } = nameOrCookie;
        cookieStore.set(name, { value: v, options: rest });
      }
    },
    delete: (arg: string | { name: string }) => {
      cookieStore.delete(typeof arg === "string" ? arg : arg.name);
    },
  };
}

// ---- test controls ----------------------------------------------------------

export function setHeader(name: string, value: string): void {
  headerStore.set(name.toLowerCase(), value);
}

/** Put a cookie on the "request", as a browser would have sent it. */
export function setCookie(name: string, value: string): void {
  cookieStore.set(name, { value, options: {} });
}

/** What a cookie holds now, to read back what an action wrote. */
export function getCookie(name: string): string | undefined {
  return cookieStore.get(name)?.value;
}

/** The options an action set a cookie with (httpOnly, maxAge, ...). */
export function getCookieOptions(name: string): CookieOptions | undefined {
  return cookieStore.get(name)?.options;
}

/** Back to a blank request: no headers, no cookies. */
export function resetRequest(): void {
  headerStore.clear();
  cookieStore.clear();
}
