import { NextResponse, type NextRequest } from "next/server";

/* A listener's or compare's address, or a listener's API call, whose
   percent-encoding can't be read: a hand-typed `/u/abc%`, `/u/abc%zz` or a
   cut-off UTF-8 sequence. Next's own routing decodes each segment to match
   the dynamic routes, before any of the app runs, and on these it answered a
   bare "Internal Server Error" as plain text (500), logging nothing. A proxy
   runs first, on the path as sent: a page goes to the app's not-found page,
   a 404, and an API call gets the 400 and code a page reads.

   The matcher takes only paths with a "%" in them, which no real Last.fm
   name needs, so an ordinary request never runs this. */
export function proxy(req: NextRequest) {
  try {
    decodeURIComponent(req.nextUrl.pathname);
    return NextResponse.next();
  } catch {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Invalid username", code: "invalid-username" }, { status: 400 });
    }
    // No route answers here: folders starting "_" are private in the app
    // router, so this renders the app's not-found page with a 404.
    return NextResponse.rewrite(new URL("/_unreadable", req.url));
  }
}

export const config = {
  matcher: ["/u/(.*%.*)", "/vs/(.*%.*)", "/api/user/(.*%.*)"],
};
