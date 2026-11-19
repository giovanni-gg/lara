import { redirect } from "next/navigation";

// Decks is the home screen: its header carries the day's Due / New / Done
// and the Study button that used to live on a separate Today page.
export default function Home() {
  redirect("/decks");
}
