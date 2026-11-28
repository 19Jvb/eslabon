import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Hábito no encontrado" };

// Where the proxy rewrites /app/habitos/<id> when the habit is not the user's. notFound() runs here while
// prerendering, before the response begins, so the status is a real 404; and outside /app, with nothing that depends
// on the session, it is the same page whatever the id was.
export default function MissingHabit() {
  notFound();
}
