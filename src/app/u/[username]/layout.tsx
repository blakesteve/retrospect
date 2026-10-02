import { Suspense } from "react";
import { ListenerShell } from "@/components/listener/Shell";

/* The listener shell (spec 8.2) lives here, so the three views share it:
   switching views never restarts the polling or the sheet host, and its
   chunk is shared rather than copied per route (13). */

export default async function ListenerLayout({
  params,
  children,
}: {
  params: Promise<{ username: string }>;
  children: React.ReactNode;
}) {
  const { username } = await params;
  const name = decodeURIComponent(username);
  return (
    // The shell reads the URL's search parameters (sheets, tz).
    <Suspense fallback={null}>
      <ListenerShell username={name}>{children}</ListenerShell>
    </Suspense>
  );
}
