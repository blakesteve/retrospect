/** What a Last.fm username can look like, as far as Retrospect accepts one.
    Shared by the routes that act on a name and the pages that ask for one. */
export function isValidUsername(name: string): boolean {
  return /^[a-zA-Z0-9_ .-]{1,50}$/.test(name);
}
