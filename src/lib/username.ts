/** What a Last.fm username can look like, as far as Retrospect accepts one.
    Shared by the routes that act on a name and the pages that ask for one. */
export function isValidUsername(name: string): boolean {
  return /^[a-zA-Z0-9_ .-]{1,50}$/.test(name);
}

/** A name from a URL segment, decoded. Next has usually decoded the segment
    already, so this is a second decode: harmless for a real name, which has
    no "%", but `decodeURIComponent` throws on one that decodes to a "%"
    (`/u/abc%25`), and a page's metadata or an API route answered 500. Such a
    segment is taken as it stands, and `isValidUsername` turns it away like
    any other name Last.fm couldn't have. A segment whose encoding is broken
    (`/u/abc%`) never gets here: Next's own routing fails on it first, so
    `src/proxy.ts` catches those. */
export function decodeName(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
