"use client";

import { useId, useState, type ReactNode } from "react";
import { Button, Pill, SegmentBar } from "@blakesteve/roster";
import type { AnswerWord } from "@/lib/answers/words";
import { Jar, WORD_COLOR } from "./jar";

/* The shared pieces (spec 8.9): answer pills, the fluke meter, the storm
   meter, the jar and the icon set. Meters and drawings are aria-hidden with
   the same information in the text beside them (11). */

export { WORD_COLOR, Jar };

/** The answer word as a pill: a solid fill with sky ink, 5.8 to 10.1:1 (11). */
export function AnswerPill({ word, className = "" }: { word: AnswerWord; className?: string }) {
  const quiet = word === "Not checked" || word === "Checking";
  return (
    <Pill
      size="md"
      className={`font-semibold ${quiet ? "border border-[var(--word-quiet)] bg-transparent text-ink-2" : "text-[var(--sky)]"} ${className}`}
      style={quiet ? undefined : { backgroundColor: WORD_COLOR[word] }}
    >
      {word}
    </Pill>
  );
}

const LIKELIHOODS = ["Very unlikely to be chance.", "Unlikely to be chance.", "Could be chance.", "Could easily be chance."];
const NOTCH_LABELS = ["Very unlikely", "Unlikely", "Could be", "Could easily be"];
const OFF = "rgba(242,239,230,.12)";

/** The fluke meter: four notches, one lit, for the four likelihood phrases
    (9.1), labeled in words. A meter, never a number. */
export function FlukeMeter({ likelihood, word, labels = true }: { likelihood: string; word: AnswerWord; labels?: boolean }) {
  const on = LIKELIHOODS.indexOf(likelihood);
  return (
    <div aria-hidden className="w-full">
      <SegmentBar
        showLegend={false}
        size="md"
        segments={NOTCH_LABELS.map((label, i) => ({ key: label, label, value: 1, color: i === on ? WORD_COLOR[word] : OFF }))}
      />
      {labels && (
        <div className="mt-1.5 grid grid-cols-4 text-[11px] leading-tight text-ink-2">
          {NOTCH_LABELS.map((l, i) => (
            <span key={l} className={i === on ? "font-semibold text-ink" : ""}>
              {l}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** The storm meter: 9 cells lit to the Kp number, aurora-colored at 5 and up
    (8.9). NOAA's thirds light the cell they round to: 6- (5.67) lights 6. */
export function StormMeter({ kp }: { kp: number }) {
  return (
    <div aria-hidden className="w-40 max-w-full">
      <SegmentBar
        showLegend={false}
        size="sm"
        segments={Array.from({ length: 9 }, (_, k) => {
          const cell = k + 1;
          const lit = kp >= cell - 0.34;
          return { key: String(cell), label: `Kp ${cell}`, value: 1, color: lit ? (cell >= 5 ? "var(--aurora)" : "var(--indigo)") : OFF };
        })}
      />
    </div>
  );
}

const PATHS: Record<string, ReactNode> = {
  storm: (
    <>
      <path d="M3 13c2.5-3.5 5.5-3.5 9 0s6.5 3.5 9 0" />
      <path d="M3 8.5c2.5-3.5 5.5-3.5 9 0s6.5 3.5 9 0" opacity=".55" />
      <path d="M5 20a9 5 0 0 1 14 0" />
    </>
  ),
  flare: (
    <>
      <circle cx="10" cy="14" r="5.5" />
      <path d="M13.5 9.5c1.5-3 4-4.5 7-4.5-1 2.5-2.5 4.5-5 5.8" />
      <path d="M10 3.5v2M3.5 14h-1M4.8 8.8l-1-1" />
    </>
  ),
  asteroid: (
    <>
      <path d="M9 8.5l4-2.5 4.5 1.5 1.5 4.5-2 4.5-4.5 1.5-4-2-1-4.5z" />
      <circle cx="12.5" cy="11" r="1" />
      <path d="M2.5 20l4-4M2.5 15.5l2.5-2.5" />
    </>
  ),
  eclipse: (
    <>
      <circle cx="12" cy="12" r="5.5" fill="currentColor" fillOpacity=".15" />
      <circle cx="12" cy="12" r="8.5" strokeDasharray="1.5 2.2" />
      <circle cx="16.5" cy="7.8" r="1.2" fill="currentColor" />
    </>
  ),
  fireball: (
    <>
      <circle cx="16.5" cy="7.5" r="3" />
      <path d="M14.3 9.7L4 20M12.5 8.5L6 15M15.5 10.8L9.5 17" />
    </>
  ),
  shuffle: (
    <>
      <path d="M3 7h4l10 10h4M17 7h4M3 17h4l3-3M14 10l3-3" />
      <path d="M19 5l2 2-2 2M19 15l2 2-2 2" />
    </>
  ),
  share: (
    <>
      <path d="M12 15V3M7.5 7.5L12 3l4.5 4.5" />
      <path d="M5 12v7.5h14V12" />
    </>
  ),
  sparkle: <path d="M12 3l1.8 5.7L19.5 10.5l-5.7 1.8L12 18l-1.8-5.7-5.7-1.8 5.7-1.8z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  chev: <path d="M9 5l7 7-7 7" />,
};

export type IconName = keyof typeof PATHS;

/** The app's inline icon set (12: nothing in Roster covers these). */
export function Icon({ name, className = "size-[1.15em]" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`inline-block shrink-0 ${className}`}
    >
      {PATHS[name]}
    </svg>
  );
}

/** A heading, an optional "See all", and a row (8.4, 11). */
export function Row({
  id,
  title,
  sub,
  action,
  children,
}: {
  id: string;
  title: string;
  sub?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-h`} className="mt-10">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`${id}-h`} className="font-display text-[25px] leading-tight text-ink">
            {title}
          </h2>
          {sub && <p className="mt-1 text-[13px] text-ink-2">{sub}</p>}
        </div>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Terms explained on tap (9.4), word for word. */
export const TERMS = {
  Kp: "How hard the solar wind shook Earth's magnetic field, on a scale of 0 to 9, in thirds (6- is just under 6). Storms start around 5. NASA logs storms, not quiet nights.",
  "G1 to G5": "Storm grades, from G1 minor (Kp 5) to G5 extreme (Kp 9).",
  "Flare classes": "Flares come in classes A, B, C, M and X. Each step is ten times stronger than the last.",
  "Lunar distance": "The distance from Earth to the Moon, about 384,000 km.",
  DSCOVR: "A NOAA satellite a million miles out, whose NASA camera, EPIC, photographs the whole sunlit Earth most days.",
  "At home": "A planet in a sign it rules, working at full strength.",
  Exalted: "A planet in the sign where it's an honored guest: strong.",
  Detriment: "A planet opposite its home, working against the grain.",
  Fall: "A planet opposite where it's exalted, at its weakest.",
  "Neutral sign": "No major dignity or debility. Minor dignities, like triplicity, aren't counted.",
  Retrograde: "When a planet seems to move backward against the stars.",
  Station: "The moment a planet seems to stop before changing direction.",
  "Trine, sextile": "Planets 120° or 60° apart, the easy, cooperative angles. Counted within 3°.",
  "A night":
    "A night runs from 4 a.m. to 4 a.m., so a 1 a.m. song belongs to the night before. Your whole history is read in the time zone your browser is in now.",
} as const;
export type TermName = keyof typeof TERMS;

/** A term popover (9.4, 11): the term is a button with `aria-expanded`, the
    explanation follows it in the DOM, and Escape closes it with focus left
    on the term. */
export function Term({ name }: { name: TermName }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="inline">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
        className="inline-flex min-h-11 items-center text-[13px] text-ink-2 underline decoration-dotted underline-offset-4 hover:text-gold"
      >
        {name}
      </button>
      <span id={id} hidden={!open} className="mb-2 block rounded-xl border border-[var(--line)] bg-surface-2 px-3 py-2 text-[13px] leading-relaxed text-ink">
        {TERMS[name]}
      </span>
    </span>
  );
}

/** A row of terms under a section. */
export const Terms = ({ names }: { names: TermName[] }) => (
  <p className="mt-1 flex flex-wrap gap-x-4">
    {names.map((n) => (
      <Term key={n} name={n} />
    ))}
  </p>
);

/** A sheet that failed (8.7): "This didn't load." with "Try again". */
export function SheetFailed({ retry }: { retry: () => void }) {
  return (
    <div className="py-6">
      <p className="text-ink">This didn&rsquo;t load.</p>
      <Button size="lg" variant="outline" className="mt-3" onClick={retry}>
        Try again
      </Button>
    </div>
  );
}

/** A sheet still loading (8.7): a skeleton under the header. */
export const SheetSkeleton = () => (
  <div className="space-y-3 py-2" aria-hidden>
    <div className="skeleton h-40" />
    <div className="skeleton h-6 w-2/3" />
    <div className="skeleton h-24" />
  </div>
);

/** "{Row name} didn't load. Refresh to try again." (8.4: a row failed). */
export const RowFailed = ({ name }: { name: string }) => (
  <p className="text-sm text-ink-2">{name} didn&rsquo;t load. Refresh to try again.</p>
);
