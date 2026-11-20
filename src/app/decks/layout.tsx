import { CardJobsProvider } from "@/components/card-jobs";

// One watcher for AI card jobs across the decks section: it outlives going
// from a deck to the list and back, and nothing outside /decks shows a job.
export default function DecksLayout({ children }: LayoutProps<"/decks">) {
  return <CardJobsProvider>{children}</CardJobsProvider>;
}
