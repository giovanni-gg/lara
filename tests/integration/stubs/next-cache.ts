// Stand-in for `next/cache`.
//
// Server actions end with `revalidatePath(...)` so the page re-reads from
// Postgres. That call only means something inside a Next request and throws
// outside one. Tests read the row back from the database directly, which is
// the stronger check, so here the call is recorded and discarded.
//
// `revalidated` is exported so a test can assert an action DID ask for a
// revalidate. tests/integration/setup.ts clears it before every test.

export const revalidated: string[] = [];

export function revalidatePath(path: string, type?: "layout" | "page"): void {
  revalidated.push(type ? `${path} (${type})` : path);
}

export function revalidateTag(tag: string): void {
  revalidated.push(`tag:${tag}`);
}

export function updateTag(tag: string): void {
  revalidated.push(`tag:${tag}`);
}

export function refresh(): void {
  revalidated.push("refresh");
}

/** Forget everything recorded so far. */
export function clearRevalidated(): void {
  revalidated.length = 0;
}
