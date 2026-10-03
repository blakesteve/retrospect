/* An invalid sheet parameter opens nothing and says so (8.7), as a Roster
   toast over the top of the page rather than a line of body text a reader
   can miss. The toaster loads the first time there's something to say:
   mounted with the page it cost every view 19 KB and the landing 92 KB of
   first-load JS, for a message most visits never see. */

export const INVALID_LINK = "That link points to something that isn't in this history.";

let host: Promise<typeof import("./toastHost")> | null = null;

export const sayInvalidLink = () => {
  host ??= import("./toastHost");
  void host.then((h) => h.say(INVALID_LINK));
};
/** A sheet that does open clears it. */
export const clearInvalidLink = () => void host?.then((h) => h.clear());
