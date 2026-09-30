import { NextResponse } from "next/server";
import { requestRemoval } from "@/lib/removal";
import { isValidUsername } from "@/lib/username";

export const dynamic = "force-dynamic";

/**
 * POST /api/user/:name/remove  body: { "confirm": "<the same name>" }
 *
 * Deletes everything stored under the name. POST only, and on purpose there is
 * no GET: a link preview, a crawler or a prefetch follows links with GET, and
 * none of them should ever be able to remove anything. The body has to repeat
 * the name, so a stray POST with no body does nothing either.
 *
 * Every answer carries `outcome`; the page turns it into words
 * (`lib/removalCopy.ts`). `keys` lists each stored key, whether it existed
 * and whether it's gone, read back after deleting: the record that the
 * removal did what it says.
 */
async function handler(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const username = decodeURIComponent(name).trim();
  if (!isValidUsername(username)) {
    return NextResponse.json({ outcome: "invalid", error: "Invalid username" }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  const confirm = typeof body?.confirm === "string" ? body.confirm.trim() : "";
  if (confirm.toLowerCase() !== username.toLowerCase()) {
    return NextResponse.json(
      { outcome: "invalid", error: "The body's `confirm` must repeat the username." },
      { status: 400 },
    );
  }

  const result = await requestRemoval(username);
  switch (result.kind) {
    case "removed":
      console.log(
        `[retrospect] removed ${result.keys.filter((k) => k.existed).length} of ${result.keys.length} keys`,
      );
      return NextResponse.json({ outcome: "removed", keys: result.keys });
    case "failed": {
      const left = result.keys.filter((k) => !k.gone).map((k) => k.key);
      console.error(`[retrospect] removal left keys behind: ${left.join(", ")}`);
      return NextResponse.json({ outcome: "server", keys: result.keys }, { status: 500 });
    }
    case "nothing-stored":
      return NextResponse.json({ outcome: "nothing-stored" });
    case "busy":
      return NextResponse.json({ outcome: "busy" }, { status: 409 });
    case "cooldown":
    case "too-many":
      return NextResponse.json(
        { outcome: result.kind, retryAt: result.retryAt },
        {
          status: 429,
          headers: { "Retry-After": String(Math.max(1, Math.ceil((result.retryAt - Date.now()) / 1000))) },
        },
      );
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ name: string }> }) {
  try {
    return await handler(req, ctx);
  } catch (err) {
    console.error(`[retrospect] route failure:`, err);
    return NextResponse.json(
      { outcome: "server", error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
