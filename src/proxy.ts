import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, gateState, isValidSession } from "@/lib/auth";

// Public routes the matcher can't exclude by itself (static assets are
// excluded there). Server actions POST to their own page, so the login
// action is covered by "/login" too.
const PUBLIC_PATHS = new Set(["/login", "/api/health"]);

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const gate = gateState();
  if (gate.mode === "open") return NextResponse.next();
  if (gate.mode === "misconfigured") {
    return new NextResponse("LARA_ACCOUNTS (or LARA_PASSWORD) is not configured", { status: 503 });
  }

  if (await isValidSession(request.cookies.get(AUTH_COOKIE)?.value)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const login = new URL("/login", request.url);
  login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    // Everything except Next internals, the favicon, the PWA manifest, and
    // top-level images (public/*.svg, app-router icon.png / apple-icon.png).
    // Images are only skipped at the root, so /api/media/x.png stays gated.
    "/((?!_next/static|_next/image|favicon\\.ico$|manifest\\.webmanifest$|[^/]+\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
