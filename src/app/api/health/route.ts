import { prisma } from "@/lib/db";

// Public (see proxy.ts): lets a deploy be checked without signing in.
// Reports only whether the database answers — never any data.
export async function GET() {
  let db = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch {
    db = false;
  }
  return Response.json({ ok: true, db }, { headers: { "Cache-Control": "no-store" } });
}
