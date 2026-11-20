import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { recentCardJobs } from "@/lib/card-jobs";

/**
 * The learner's recent card jobs, for the status pill (`?active=1`, polled
 * every ~2 s while one is in progress). One indexed query beyond the session.
 */
export async function GET() {
  const user = await getCurrentUser();
  const jobs = await recentCardJobs(user.id);
  return NextResponse.json({ jobs }, { headers: { "cache-control": "no-store" } });
}
