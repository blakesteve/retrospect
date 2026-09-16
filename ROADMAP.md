# retrospect — Roadmap

## Done

### Roster 4.12.1 (16 September 2026)

Bumped `^4.8.1` to `^4.12.1`, four minors. The API gap is additive and the
build never moved, so the work was the visual diff, not the version number.

Of the ten changes after 4.8.1, four reach this app: one hit-target change that
repaints nothing, two small repaints, and one that changes how a component
sizes itself:

- **#176 touch targets.** Every `Checkbox` now carries a 44x44 hit area on a
  `before:` pseudo-element. Measured at all three sizes: the visible box is
  still 16 / 20 / 24px and the target is 44x44 on each. The overhang has two
  documented hazards, neither of which bites here. Nothing interactive overlaps
  either checkbox's target rect, and no ancestor of either clips it.
- **#162 control boundaries.** The default `--roster-control-border` moved from
  gray-300 / gray-700 to gray-500 / gray-400. This app sets all four
  `--roster-control-*` in both scopes, so `Input` and the `Select` triggers did
  not move. The one repaint is the unchecked `Checkbox`, which used to hardcode
  `border-gray-300` / `dark:border-gray-700` and now reads the same token as
  every other field: its border goes from this app's gray-700 (`#3a405e`) to
  `--hairline`, the gold at 28%. It matches the `Input` above it now.

  The boundary got slightly more contrast, not less: `#3a405e` on the
  `gray-900` fill was 1.63:1 and the gold hairline is 1.75:1. But 1.4.11 is the
  point of #162 and this app opts out of it either way, since Roster's own
  default would have reached 3:1. That is the same trade the `Input` has been
  making since 4.8.0, and it is a palette decision, not a bump regression.

  `Input` did change, and the reason it does not show here is worth writing
  down rather than being lucky about: its `Label` moved from
  `text-gray-900 dark:text-gray-100` to `--roster-control-text`, which under
  this palette would be `#e7e9f3` to `#f2efe6`. No `Input` in this app passes
  `label`; every field is titled by `aria-label` or by a nearby element the app
  owns. The two `Select`s DO pass `label`, and theirs moved from `text-inherit`
  to the same token, which resolves to `#f2efe6` either way here. Measured both
  labels at `rgb(242, 239, 230)`, identical to the body ink.
- **#170 container sizing.** `Countdown` in `SkyCalendar` sizes against its own
  container now, and the steps moved from viewport breakpoints to container
  ones. The section is `max-w-2xl` inside `px-6`, so the container is
  `viewport - 48` up to 672px, and the effect is not one-directional. Measured:

  | Viewport | Container | Gutter before | Gutter after | Label |
  |---|---|---|---|---|
  | 1280px | 672px | 32px | 32px | 12px, unchanged |
  | 700px | 652px | 24px | 32px | 12px, unchanged |
  | 620px | 572px | 16px | 32px | 12px, unchanged |
  | 500px | 452px | 16px | 24px | 12px, unchanged |
  | 390px | 342px | 16px | 12px | 12px to 9px |
  | 375px | 327px | 16px | 12px | 12px to 9px |

  `gap-8` now starts at a 608px viewport rather than 768px, so it is roomier
  through the whole tablet and large-phone band, doubling at 620px, and tighter
  only below a 400px viewport, where the labels also drop to 9px with the
  tracking cut. Nothing clips and nothing overflows at any width. The 9px
  labels are the one place this reads as a loss, on a row that already fit at
  12px. Filed rather than worked around.
- **#173 elevation.** The only Roster surface here that took a level is the
  `Select` panel, now `elevation-anchored` in place of `shadow-lg`. Same size,
  same fill, same gold ring, a firmer shadow.

Four more were verified as no-ops rather than assumed to be. #168 restyled
anchored panels, and the `Select` menu keeps this app's `--roster-popover-*`
fill; it also gained `font-ui`, so the menu stops inheriting `--font-body` and
reads `--roster-font-ui`, which this app never sets and whose fallback lands on
the same `ui-sans-serif`. #172 renamed two things, not one: `--rst-font-mono`
to `--roster-font-mono`, and `--rst-enter-duration` / `-easing` to
`--roster-enter-*`. This app reads no `--rst-` property at all, so neither
rename touches it. #176 also retuned `CheckboxGroup` row gaps, and this app has
no `CheckboxGroup`.

`Button`, `Spinner`, `LiquidTabs`, `MatchupCard` and `Disclosure` have no
source change at all across the four minors.

The bundle grew for a reason that has nothing to do with this app, and the
weight is the smaller half of it.

`Toast` shipped in 4.9.0, and 4.12.x declares `react-hot-toast` as a
NON-OPTIONAL peer dependency. Roster's ESM entry imports it at the top level,
unconditionally, so it is required at runtime by ANY import from the barrel,
not just by `Toast`. This app imports `Toast` nowhere and needs it anyway.
`goober` comes along as react-hot-toast's own dependency, and both land in the
client chunk.

Neither is declared in this app's `package.json`. It resolves today because
npm auto-installs a non-optional peer and the lockfile records both, so
`npm ci` is fine. It is still an undeclared runtime dependency, and the failure
mode is the quiet one: anything that prunes to declared dependencies stays
green through lint, typecheck, tests and build, and breaks on first render.

Deliberately NOT patched here. Adding `react-hot-toast` to this app's
dependencies is the per-app workaround that leaves six apps carrying six copies
of one packaging bug. The fix belongs in Roster: bundle it, or move `Toast`
behind a subpath export so the barrel stops importing it.

Total client JS goes from 1,658,229 to 1,790,737 bytes raw and 483,556 to
518,197 gzipped. Roster's vendor code is emitted in two near-identical chunks, so a
single copy is about +64.7 kB raw and +16.9 kB gzipped. CSS adds 10.7 kB raw
and 1.5 kB gzipped. It is a known Roster defect and `sideEffects` in 4.12.1
does not shake it loose.

This bump made a dent in the 5 September entry's open eyeball, not more than
that. The `/u/{username}` report page did finish syncing this time, so
`LiquidTabs`, the two era month fields and the noise checkbox were opened and
measured, and all are unchanged but for that checkbox border. The slider,
`replay the reveal`, `GenresPanel`, `SkyScan` and `StoryIntro` are still
unverified and the 5 September note stands.

### Roster sweep (5 September 2026)

Bumped to `^4.8.0` and replaced 17 of the 19 raw controls the 27 Aug audit
found. Both things that blocked the `UsernameForm` swap were fixed in 4.8.0
itself: `Input` gained `Button`'s size scale, so `size="lg"` is `h-11` on each
and the pair is height-matched by construction rather than by a hardcoded
number; and `outline` now reads `--roster-control-bg` / `-border` /
`-border-focus` / `-text` instead of hardcoding them, so the deep indigo field
with the gold hairline is reachable from `app/globals.css`. `inputClassName`
covers what the tokens do not.

One raw control remains, with the reason at the usage:

- [x] ~~**The UTC-offset `<select>` in `BirthChartPanel`.**~~ Swapped on
      6 September 2026 against Roster 4.8.1. The stated reason for keeping it
      native was wrong: Roster's menu has always had a max-height and scrolled,
      because Headless UI's `size` middleware writes `overflow: auto` and
      `max-height: min(var(--anchor-max-height, 100vh), Npx)` inline on the
      panel whenever `anchor` is set. What actually blocked it was theming — the
      menu ignored this app's palette — and 4.8.1 fixed that with
      `--roster-popover-*`. Verified open: 53 options, capped at 480px on a
      1000px viewport, scrolling, on `--surface-2` with the gold hairline and
      this app's ink.
- [ ] **The threshold `<input type="range">` in `Report`.** Roster has no
      Slider. The native control reads `accent-color`, so it already takes the
      gold. Would be a reasonable Roster candidate.

Not visually verified: the `/u/{username}` report page. The two era month
fields, the slider, `replay the reveal`, `GenresPanel`, `SkyScan` and
`StoryIntro` are typecheck- and build-clean with every layout class preserved,
but no report finished syncing during the work. Worth an eyeball, especially
the `threshold` refactor.

## Next

### Product

- [ ] **Deep-dive UX investigation.** The app has a genuinely good idea in it
      and the landing page does not spend it well. This is an investigation, not
      a redesign: the deliverable is a written finding with evidence, and the
      redesign is whatever that finding argues for.

      **The question to answer.** A first-time visitor arrives, reads the pitch,
      and has to decide whether to type their Last.fm username in. What are they
      being asked to trust, and what do they get back? The page asks for the
      commitment before it shows the payoff, and there is no sample reading
      anywhere on it. For a tool whose whole value is a surprising personal
      result, one stranger's result on the landing page would do more than any
      amount of copy.

      **Three things to look at first**, all visible without an account:

      - **Two primary actions compete above the fold.** "Consult" takes one
        username; "OR SETTLE IT: WHOSE SKY IS STRONGER?" takes two and a Fight
        button. They carry equal weight. Which one is the product, and which is
        the party trick? Answering that probably reorders the whole page.
      - **"With a p-value" is the thesis and the risk in one phrase.** Real
        statistics applied to something soft is the best thing about this app,
        and most visitors do not know what a p-value is. Does the report teach
        it or assume it? If it assumes, the most defensible thing here reads as
        noise to the people it was meant to convince.
      - **"THE SKY, CURRENTLY" and the countdown take a large share of the first
        screen**, and nothing about them is actionable. Ambient mood against
        showing what a reading actually looks like is a real trade. It has been
        made in favor of mood by default rather than on purpose.

      Then the report itself, which needs a real account to see and is where
      "not intuitive" most likely bites hardest.

      **Out of scope:** the `/u/{username}` control sweep below. That is a
      separate and much smaller job, and bundling them would bury this one.

      This section exists because the file did not have one. Everything else
      here is maintenance: a Roster sweep, lint, and CI. Nothing in it was about
      the product, which is part of why the product has not moved.

### Quality

- [x] ~~Two `react-hooks/set-state-in-effect` errors and an unused import.~~
      Lint is at zero. `Report`'s was a real fix: `threshold` started at a
      hardcoded 365 and was corrected a frame later by an effect, and is now
      seeded from `body`/`metricChoice` and adjusted during render, which is
      the same end state with one less render. `BirthChartPanel`'s is
      suppressed with the reasoning inline — it reads `localStorage` on mount,
      and a lazy initializer there renders "your chart" against a server that
      rendered "add your birth chart", which is a hydration mismatch.
- [x] ~~Run `lint` + `typecheck` + `test` in CI.~~ `.github/workflows/ci.yml`,
      matching bb-memorial's. Added a `typecheck` script, which did not exist.
