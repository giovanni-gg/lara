// Stand-in for `next/server`.
//
// `after(callback)` schedules work for after the response, and throws outside
// a live Next request. Here it queues the callback, and a test runs the queue
// with `await settleAfter()` once it has looked at the response: so a test
// sees both what the response left behind and what the background work wrote
// afterwards. Everything else is the real Next export.
//
// tests/integration/setup.ts drops anything still queued before every test.

export { NextRequest } from "next/dist/server/web/spec-extension/request";
export { NextResponse } from "next/dist/server/web/spec-extension/response";

type Task = Promise<unknown> | (() => unknown);

const queued: Task[] = [];

export function after(task: Task): void {
  queued.push(task);
}

/** Runs every `after()` callback scheduled so far (and any they schedule); rethrows the first failure. */
export async function settleAfter(): Promise<void> {
  while (queued.length > 0) {
    await Promise.all(queued.splice(0).map((task) => (typeof task === "function" ? task() : task)));
  }
}

/** Drops whatever is still queued, unrun. */
export function clearAfter(): void {
  queued.length = 0;
}
