import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Prisma 7 talks to Postgres through a driver adapter. `pg` speaks plain TCP,
// so the same code path serves the local `prisma dev` server and Neon.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Run `npm run db:dev` and copy the printed URL into .env",
    );
  }
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: explicitSslMode(connectionString) }),
  });
}

/**
 * Neon's URL says `sslmode=require`, which `pg` already treats as
 * `verify-full` but warns about on every cold start. Saying `verify-full`
 * keeps the same (strict) behaviour without the noise in the error logs.
 */
export function explicitSslMode(url: string): string {
  return url.replace(/([?&]sslmode=)(prefer|require|verify-ca)(?=&|$)/, "$1verify-full");
}

// Reuse the client across hot reloads in dev, and across warm Fluid Compute
// invocations in production.
export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
