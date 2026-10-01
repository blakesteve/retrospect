import photos from "@/data/space-photos.json";
import events from "@/data/space-events.json";

/**
 * The two curated lists (spec 7.3), checked by hand against their sources and
 * committed: NASA Image Library photos of events in the nights, and the only
 * superlatives Retrospect says. `curated.test.ts` pins their rules.
 */

export type CuratedKind = "eclipse" | "storm" | "flare" | "asteroid";

export interface SpacePhoto {
  nasaId: string;
  kind: CuratedKind;
  /** UTC instant of the event the photo shows; its night is the listener's
      night that holds it. Null for a fact photo. */
  eventAt: string | null;
  /** "night": shown on its event's night. "fact": a Surprise fact only. */
  showOn: "night" | "fact";
  /** When the photo itself was taken, as dates. */
  taken: { from: string; to: string };
  image: string;
  page: string;
  caption: string;
  credit: string;
}

export interface SpaceEvent {
  id: string;
  kind: CuratedKind;
  /** UTC instant; the event belongs to the listener's night that holds it. */
  at: string;
  title: string;
  story: string;
  source: string;
  /** The source's own words, one quote for each claim in the title and story. */
  sourceSays: string[];
  /** When the source said it. */
  asOf: string;
}

export const SPACE_PHOTOS = photos.photos as SpacePhoto[];
export const SPACE_EVENTS = events.events as SpaceEvent[];
