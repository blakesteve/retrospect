import { KEEP_DAYS, REMOVAL_CAP } from "./retention";
import { visitorError, type VisitorError } from "./visitorErrors";

/**
 * What the "remove my data" page says for each answer the removal route can
 * give. Like `visitorErrors.ts`, the route's own `error` text never reaches the
 * page: it sends an `outcome`, and this turns it into words. Free of server
 * imports so the page can use it.
 */

export const REMOVAL_OUTCOMES = [
  "removed",
  "nothing-stored",
  "busy",
  "cooldown",
  "too-many",
  "invalid",
  "server",
  "network",
] as const;

export type RemovalOutcomeCode = (typeof REMOVAL_OUTCOMES)[number];

export function toRemovalOutcome(value: unknown): RemovalOutcomeCode {
  return typeof value === "string" && (REMOVAL_OUTCOMES as readonly string[]).includes(value)
    ? (value as RemovalOutcomeCode)
    : "server";
}

/** `when` is the time a limit lifts, already written for the visitor's clock. */
export function removalMessage(
  outcome: RemovalOutcomeCode,
  username: string,
  when = "a day",
): VisitorError {
  switch (outcome) {
    case "removed":
      return {
        title: "Removed.",
        body: `Retrospect no longer keeps any of ${username}'s listening. Looking the name up again reads the whole history fresh from Last.fm.`,
      };
    case "nothing-stored":
      return {
        title: "Nothing to remove.",
        body: `Retrospect isn't keeping anything for ${username}.`,
      };
    case "busy":
      return {
        title: "Still reading this one.",
        body: `Retrospect is reading ${username}'s history from Last.fm right now. Close any page that's showing it, wait a minute, and try again.`,
      };
    case "cooldown":
      return {
        title: "Removed not long ago.",
        body: `${username}'s history was removed less than a day ago, and a name can only be removed once a day. Try again after ${when}.`,
      };
    case "too-many":
      return {
        title: "That's all the removing for today.",
        body: `Retrospect removes at most ${REMOVAL_CAP} histories a day, so nobody can clear out everyone's at once. Try again after ${when}. Anything it keeps is also deleted on its own about ${KEEP_DAYS} days after the name was last looked up.`,
      };
    case "invalid":
      return visitorError("invalid-username", username);
    case "server":
      return visitorError("server", username);
    case "network":
      return visitorError("network", username);
  }
}
