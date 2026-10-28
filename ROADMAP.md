# retrospect — Roadmap

**Index**

- **Done:** A listener with a record in a fresh browser, and what a screen reader is told (27 Oct 2026) · The sync bar people can hear, Roster 5.15.0, and CI in Playwright's image (25 Oct 2026) · The wheels' focus in Safari, Roster 5.14.0, and the audit fixes (24 Oct 2026) · Loading shifts, CI on Ubuntu 24.04, and Next.js 16.4.2 (24 Oct 2026) · Tonight's ℞, long names on the share card, and error pages (21 Oct 2026) · The Sky wheel's glyphs, and Roster 5.12.0 (17 Oct 2026) · Skeletons on Roster's, and the dial's touch drag (15 Oct 2026) · Compare's question sheet on phones (12 Oct 2026) · Next.js 16.4.0 and Roster 5.8.0 (11 Oct 2026) · Whole periods for the four periodic questions (6 Oct 2026) · Answers need a zone, and the null test in CI (5 Oct 2026) · Compare and the share cards (4 Oct 2026) · Sky (3 Oct 2026) · Every night (3 Oct 2026) · Browser checks in CI (3 Oct 2026) · The Tonight revision (3 Oct 2026) · NASA's fill, by priority (2 Oct 2026) · Tonight's follow-ups
  (2 Oct 2026) · Tonight, the sheets, the
  landing and the reveal (2 Oct 2026) ·
  Questions 5 and 6 test their folklore (1 Oct 2026) · Nights,
  songs, highlights and genres as facts (1 Oct 2026) ·
  NASA's data, and questions 7 and 8 (1 Oct 2026) · The answers
  engine, and stored answers (1 Oct 2026) · Real time
  zones, and nights (30 Sept) · The sky through 2035, and the redesign's sky
  data (30 Sept) · The store audit, and share cards that can't outlive a
  removal (30 Sept) · A way to remove your data, and an empty account that
  isn't a dead end (30 Sept) · The report tells the truth about its own
  confidence (28 Sept) · A young history gets a real report (28 Sept) · The
  bundle-shape guard (18 Sept) · Roster 5.0.0 (17 Sept) · Roster 4.13.0
  (17 Sept) · Roster 4.12.1 (16 Sept) · Roster sweep (5 Sept)
- **Next, product:** nothing queued after the redesign.
- **Next, quality:** a NASA answers test fails just after UTC midnight · the
  sync's end under a shared link's sheet · three "scrobble"s a visitor still
  meets · a sheet closed as it opens can freeze over the page in WebKit ·
  three dev tools' advisories wait on npm · Every night's doors in Safari ·
  loading shifts that need a design change · the nights API's bad-range 400s
  carry no code

## Done

### A listener with a record in a fresh browser, and what a screen reader is told (27 October 2026)

- **"Checking 12 questions" only while the answers are computed** (ClickUp
  86e3wjwy4). In a fresh browser, a listener with stored answers saw
  "Checking 12 questions against your sky" until their answers, songs and
  highlights had all loaded (production, squareses, 26 and 27 Oct): the
  screen showed whenever the reveal was due and any of the three was still
  loading. Spec 8.2 keeps it for a listener with no stored answers for the
  zone. The status call, asked with the page's zone, now says once the
  history is ready whether that zone's answers are stored (`answersStored`),
  and the checking step shows only when it says no, until what the reveal
  shows is in. A listener with a record sees the view while the data loads,
  then the reveal over it.
- **Reproduced first**, in fresh profiles against the seeded store: with the
  songs held 3 seconds, the sample (a record) showed the checking step for
  3,067ms though its stored answers arrived in 149; with nothing held, a
  123ms flash. In a zone with no record it showed for 534ms while they were
  computed, as it should. The record's zone isn't what the code points to:
  the captures that found it read CDT, so the browser sent America/Chicago,
  the zone Blake's own browser sends; whether squareses' record is
  Chicago's is for a production read.
- **The reveal replaying in a fresh browser is by design** (8.3: once per
  username per browser). Now that the view is live while stored answers
  load, a sheet opened in that time calls the reveal off for the visit,
  unseen, as a shared link skips it; and stored answers that fail to load
  leave the view and its own "didn't load", the failure page being the
  checking step's alone.
- **The sync's end is said** (ClickUp 86e3vqt7y): "Listening history read:
  40,000 plays.", from a status the shell holds, empty, from the start,
  since the sync screen goes as the sync ends. **The checking status** is
  given its words a moment after it appears, and they name what's counted:
  "0 of 12 questions" (it mounted holding "0 of 12", which most screen
  readers don't announce).
- **Compare says plays** (ClickUp 86e3vqt83): "newcomer: 600 of 1,900
  plays", and "1 of 1 play". So does the sync bar for a one-play history.
- **Checks:** `e2e/first-visit.spec.ts` visits in a fresh browser with the
  data held: the sample (a record) gets the view and then the reveal, never
  the checking step; `firsttimer` (no record, a new zone each repeat, so it
  evicts no one's) gets the checking step, its status empty before "0 of 12
  questions"; a sheet opened meanwhile calls the reveal off unseen; and
  stored answers failing leave the view's own message. `e2e/sync.spec.ts`
  checks the sync's end, `e2e/compare.spec.ts` the word, plural and single,
  as exact text, and `src/lib/statusRoute.test.ts` the route's answer (a
  zone's other name included, and nothing known without a zone or an
  unreadable record). Each fails on its twin, built in a copy: today's
  rule, a fix that hides the step for everyone, the status mounted holding
  its words, "0 of 12", the zone not sent, no history-read status,
  "scrobbles", no singular, no call-off, today's failure page, and a route
  that never says. Two older checks' status routes now match the query string the page
  sends (`sync.spec.ts`, `nights.spec.ts`): unmatched, they'd have stopped
  applying, and the nights one would have passed testing nothing.
- **Bundle, against `7e0edc8`'s build:** client JS 1,469,386 to 1,470,009
  (+623). First loads: the landing unchanged, Tonight, Every night and Sky
  +597 each, compare +26. The app's own CSS 42,745 to 42,790 (+45).

### The sync bar people can hear, Roster 5.15.0, and CI in Playwright's image (25 October 2026)

- **The first sync's bar is heard.** It was two divs with no role, no value
  and no status, so a screen reader waiting through a first sync heard
  nothing. It's Roster's `ProgressField` now, labeled "Listening history":
  a screen reader hears the label and the figure together from one polite
  status, "Listening history: 12,000 of 40,000 plays" (plays, not
  scrobbles, in en-US figures as compare's are); before Last.fm gives the
  total, the status reads "Loading" to anyone reading the page. At most
  every 15 seconds: a status call reads the history for up to 8 seconds, so a
  big sync moves on about every 9 seconds for minutes, and said at each the
  figure would talk over the page (Roster's default is 1.5).
  The first figure is said at once, and each after it is the newest. The
  visible pair is kept from the screen reader, so nothing is read twice.
- **Drawn as before, where it can be:** the old bar's gold on surface-2, 6px,
  filled to the figure (`.sync-bar` in globals.css; under `.dark` Roster
  fills with `primary-400`, a step lighter than the gold, on its skeleton
  gray). What changed to see: the label and the figure stand over the bar,
  the line under it says where the history reaches back to (or, until the
  first plays are in, "Locating {name} in the heavens…"), and before a
  total the bar crosses its track where it drew a 2% stub. The block grows
  from 34 to 54px.
- `e2e/sync.spec.ts` answers the status route itself: at 375 and 1280px,
  what's heard and seen, nothing cut, and the old bar's colors, measured on
  `a46e3ef`'s build; and over a sync that reads a page about every 0.6
  seconds, the first figure at once and the next 15 seconds on, the newest. On
  `a46e3ef`'s build all three fail; at Roster's default rate the second
  figure came 1.5 seconds on; without `.sync-bar`, Roster's own colors.
- **Roster 5.14.0 to 5.15.0.** Its stylesheet grew 1,764 bytes, restated in
  the bundle guard's pin (167,283 to 169,047), 1,084 of it eleven new rules
  for the Tabs' underline and its colors. A build of the bump alone has
  `a46e3ef`'s client JS to the byte.
- **The view switcher's links forward `aria-label`** (`NextNavLink`, now
  its own module): LiquidNav names a link with a count by it (5.13.0). No
  view has a count yet; `src/lib/nextNavLink.test.ts` draws the switcher
  with one, and fails without the forward.
- **Bundle, against `a46e3ef`'s build:** client JS 1,465,121 to 1,469,386
  (+4,265, all of it the field). First loads: the landing and compare
  unchanged, Tonight, Every night and Sky +4,265 each. The app's own CSS
  43,001 to 42,745 (the old bar's utilities gone); Roster's 169,047.
- **The browser checks run in Playwright's image**
  (`mcr.microsoft.com/playwright:v1.58.2-noble`), which holds Chromium,
  WebKit and every system library they load, so nothing is installed from
  Ubuntu's mirrors. This branch's first CI run sat on the libraries' apt
  step until the job's 15 minutes ran out, before a test ran: a slow Azure
  mirror, 63 packages in 11 minutes, then 3.5 on one of 13.6 MB.
  Chromium's libraries alone had taken 13 to 26 seconds. The job's ceiling
  goes from 15 to 12 minutes (healthy, 2.5 to 5.3, plus the image's pull),
  with 2, 2 and 7 on npm ci, the build and the checks, inside it so a step
  times out first and keeps its failures; every job's ceiling is now under
  15. `src/lib/ciWorkflow.test.ts` holds the ceilings, the steps' included,
  and that the image's tag is the lockfile's Playwright: the workflow as it
  was fails it, and so does an image a version behind.
- **A sheet's Escape in the browser checks waits for it to finish coming in
  and hold focus** (`escapeSheet`, `e2e/fixtures.ts`), wherever
  `focus.spec.ts` and `sky.spec.ts` close a sheet they just opened. Pressed
  sooner, it left the sheet open: on CI in WebKit (the Tonight focus check,
  more likely the image's frame stall, next), and at 20 repeats locally, 6 of
  40 of `sky.spec.ts`'s 44px-target check in Chromium and 2 of 40 in WebKit (a
  scratch config: CI runs `sky.spec.ts` in Chromium only). Focus alone wasn't
  enough: in WebKit an Escape during the entrance froze the sheet in 1 to 3 of
  about 236, out of sight but still over the page, taking every click (the
  Quality row below). With the wait, 80 of 80 in WebKit, twice, and 40 of 40
  in Chromium. The planet's focus after Clear is polled now too, as
  `focus.spec.ts` reads it: WebKit puts it there a moment late. Every night's
  sheet (`nights.spec.ts`, a door's night) waits the same way.
- **The wheels' focus checks run one WebKit page at a time**
  (`focus.spec.ts`, in order in one worker). In Playwright's image, Linux
  WebKit with several pages at once under load stopped drawing frames for a
  page until an input came: a sheet's entrance sat at its first frame, no
  animation frame fired in a second, and a mouse move set it going (which
  would end the keyboard mode these checks are about). Measured 26 Oct in
  the image: `focus.spec.ts` in WebKit failed 16 of 20 at 4 workers and
  passed 20 of 20 at 1; four runs of the whole suite, as CI runs it, 8 of 8
  in order against 7 of 8 in parallel. CI's first failure here was likely
  this, more than the Escape.
- **"The planets never wait for the stars" checks the requirement, not a
  margin.** It failed once on CI at 343.6ms against a 300ms bound, with the
  stars held 6 seconds. It now checks that the opening began before the stars
  were let through (the page's clock at their release) and within 2 seconds of
  the planets. Measured in Playwright's image, the gap was 34 to 255ms over 20
  runs of `sky.spec.ts` at 4 workers, 55 to 299 over 3 of the whole suite and
  152 to 460 at 8 workers on 4 CPUs, and the stars were let through 5.7
  seconds after the opening began, or more. An opening that waits for the
  stars fails both: a 6,077 to 6,158ms gap, started 66 to 100ms after their
  release.

### The wheels' focus in Safari, Roster 5.14.0, and the audit fixes (24 October 2026)

- **A wheel's planet keeps its ring in Safari after a click** (ClickUp
  86e3rwyff). Both wheels move focus by script when an arrow key is pressed,
  and WebKit doesn't match `:focus-visible` on an element a script focuses
  in answer to a key once the page has been clicked: a planet clicked, its
  sheet closed with Escape, and the arrows from there drew no ring (on Sky,
  the legend's Clear, clicked, then an arrow). Roster's keyboard-focus
  tracker (`useKeyFocus`, 5.13.0) runs beside every wheel whose planets open
  something (`KeyFocus`, mounted by Tonight, the landing's Tonight sample,
  the song sheet and the Sky view's wheel), and the rings answer Roster's
  variant, `:is(:focus-visible, [data-key-focus])` (the `@custom-variant` in
  globals.css). `e2e/focus.spec.ts` drives both wheels with the real mouse
  and keys in Chromium and WebKit, counting the rings that show; on `main`,
  WebKit failed both and Chromium passed both, as it still does.
  `src/lib/wheelFocus.test.ts` checks every tappable wheel has the tracker.
- **Roster 5.12.0 to 5.14.0.** Its stylesheet grew 792 bytes, restated in
  the bundle guard's pin (166,491 to 167,283). The app's own CSS ceiling
  goes from 43,000 to 44,000 (it was 22 bytes from full): the wheels' ring
  rule grew 22 bytes on the variant.
- **Bundle, against `9d0fb11`'s build:** client JS 1,458,533 to 1,465,121,
  6,172 of it Roster 5.14.0 (a build of the bump alone). First loads: the
  landing unchanged, Tonight +6,271, Every night +6,166, Sky +6,273, compare
  unchanged. The tracker is mounted beside each wheel whose planets open
  something, not by the wheel, so the landing's picture wheels don't load it
  (1,040 bytes when they did).
- **The in-range audit fixes**, by `npm update` of the flagged packages (the
  newest each range allows, as `npm audit fix` would take): nanoid,
  source-map-js and baseline-browser-mapping in the production tree, and
  brace-expansion, browserslist, js-yaml and zod among the dev tools;
  caniuse-lite, electron-to-chromium, node-releases and update-browserslist-db
  moved too, carried by browserslist 4.29.4's own ranges. `npm audit
  --omit=dev` finds nothing. The build before and after is the same to the
  byte, every client and server chunk. `npm audit fix` itself crashes in npm
  11.4.2 and 10.8.2 (its resolver, on vitest's optional peers), and so does
  updating the three it leaves (Quality, below).
- **The 12 questions' subtitle**, once the answers are in, reads "Each
  answer comes from your own listening." (the UX lead, 24 Oct). It said
  "Each answer is checked against your own history.", which a tile reading
  "Not checked" or "Too early" contradicted, on Tonight and Every night.
- **A coming-up row whose events each take one line** still lands at its
  skeleton's height (`e2e/skeletons.spec.ts`); the card's room for two lines
  was unpinned, the sample's events all taking two.

### Loading shifts, CI on Ubuntu 24.04, and Next.js 16.4.2 (24 October 2026)

- **What lands takes its skeleton's place, wherever its size can be known
  before its data.** Each part's data held back on the made-up sample, then
  let through, measured once fonts are in and nothing is moving
  (`e2e/skeletons.spec.ts`), at 375 and 1280px wide, the sheets on a
  1,300px-tall screen too and the share sheet from 476 to 639px. Shifts on
  `a6133b4`, now zero:
  - Tonight's heading is drawn at once from the zone and the clock, which is
    all it needs (`src/lib/client/heading.ts`). It took one line or two
    when the sky came.
  - The 12 questions draw their tiles at once, each word's pill a skeleton
    until the words come (+409.6px at 375, +433.6 at 1280: a progress line,
    then the tiles). The progress line is now the row's subtitle line, which
    says "Each answer is checked against your own history." once they're in
    (since 24 Oct, "Each answer comes from your own listening.", above),
    so it keeps its height. "Not checked" and "Checking" draw their outline
    inside the pill, which made them 2px taller than an answer's.
  - A row's heading holds its arrows' box (96px) on a screen with a mouse, so
    a long title takes a second line in the skeleton too ("Coming up in your
    sky", "The sky of your songs" at 375); a row too short to page keeps it.
    The songs row's skeleton holds "See all"'s own box.
  - Cards hold each line's room, whatever it says: a song's title two lines
    (+11 at 375), a genre's name one, its artists two, "Rising" its line and
    the night link two (+11), a coming-up event two and its question link two
    (+18.5 at 375).
  - Every sheet but the share sheet stands at its full height, Roster's
    92dvh: a question's, a planet's and the landing's Tonight no longer
    shrink on a tall screen (-22.7, -245 and -223.9px at 1280 by 1,300), the
    landing's answers no longer grows 196.8px, and the birth chart's sheet
    holds its height while its code loads.
  - The share sheet's skeleton draws the link and a question card's question
    as themselves, a card's answer word has the room of the widest it could
    be, and its words hold two lines (-19.5 to -49.7px from 476 to 639, and
    +30.3 for a longer question ending "Not clearly." at 476).
  - The Sky view holds the wheel key's line while tonight's sky loads (+27.5).
  - Compare shows each side's progress under its own name, in a line kept
    when it's done; the shared line left (-45).
- **Bundle, against `a6133b4`'s build:** client JS 1,453,012 to 1,458,533
  bytes, and each route's first load up by 187 (`/`) to 5,198 (Tonight);
  the app's own CSS 42,481 to 42,978 of its 43,000, 22 bytes to spare.
- **CI pinned to Ubuntu 24.04** (ClickUp 86e3v3jtd): `ubuntu-latest` became
  26.04 on 22 Oct, where Playwright 1.58.2 can't install its browsers. Every
  job has a ceiling about two and a half times its slowest healthy run, at
  least 10 minutes (test and lint 10, browser checks 12, null test 12, from 20);
  `src/lib/ciWorkflow.test.ts` holds both for every job.
- **Next.js 16.4.0 to 16.4.2**, and `eslint-config-next` with it: it clears
  Next's critical advisory. `npm audit --omit=dev` still lists three, all in
  build tooling (nanoid and source-map-js through Tailwind's PostCSS, and
  baseline-browser-mapping through browserslist), none in what the app
  serves; a full `npm audit` lists ten, the rest dev tooling.

### Tonight's ℞, long names on the share card, and error pages (21 October 2026)

- **Tonight's ℞ is 13.0px at 375px** (ClickUp 86e3rwyfe; it was 8.7px), and
  12.1px on a night's sheet, the smallest wheel a phone reads it on. It is
  0.63 of its planet's glyph (`RX_SIZE` in `sky.tsx`), was 0.42. A browser
  check puts the server's own sky for 9 p.m. on Sunday, March 23, 2025, when
  Mercury and Venus were both retrograde, in place of tonight's, draws each
  glyph and ℞ again alone in the wheels' own font, and finds no pixel any
  ℞ shares with a glyph or another ℞, on Tonight's 280px wheel and the
  night's 260px one; both planets still say "retrograde".
- **A long name fits the generic share card** at every length a name can
  have (50 characters). It is set smaller as it grows (wide card 72, 56 and
  44px; tall 96, 72 and 56px) and broken wherever the line runs out, since
  a Last.fm name usually has no space to wrap at; the Moon stays in frame.
  The song, night and question cards' headers end a long name in an
  ellipsis. A test renders the route with the bundled Satori at 1, 25 and
  50 characters, wide and tall, and counts the ink inside the frame's
  padding: none. On `main` the 25- and 50-character cards drew 2,372 to
  3,959 pixels there, and a question card's header 411 (wide) and 693
  (tall).
- **Error pages in the app's own words.** `not-found.tsx` (plain markup: no
  script, and two utilities, 225 bytes of CSS), `error.tsx` (the words for a
  failure on our side, Try again, and a way back to the start) and
  `global-error.tsx`. A page that throws used to show Next's "This page
  couldn't load".
- **A hand-typed address whose encoding can't be read** (`/u/abc%`,
  `/vs/a%/b`) answered a bare "Internal Server Error" (500): Next's own
  routing decodes each segment before any of the app runs. `src/proxy.ts`
  sends those to the not-found page with a 404, and an API call gets a 400
  with the `invalid-username` code; it runs only for paths with a "%" in
  them. Checked on `next start`: on Vercel, its own router matches these
  paths, so a preview is still to check. A name that decodes to a "%"
  (`/u/abc%25`) threw in the app's own second decode, so the page said
  "Something went wrong on our side"; it now says the name isn't a Last.fm
  username. The profile and avatar routes check the name as the others do.
- **Every page's first load grew 7,059 bytes** for the two error
  boundaries, which Next loads everywhere. With Roster's EmptyState and
  Button in them it was 64,807, a second copy of what the landing's forms
  already load, so Try again's Button loads only when the error page draws.
  The bundle guard's JS ceiling goes to 1,523,000 (client JS 1,389,108 to
  1,453,012 against `f778fdf`). The app's own CSS is 42,481
  of 43,000 (+225, two utilities for the not-found page).
- **`npm run lint` fails on a warning** (`--max-warnings=0`), so zero stays
  zero.

### The Sky wheel's glyphs, and Roster 5.12.0 (17 October 2026)

- **Planets close together no longer cover each other on the Sky wheel**
  (ClickUp 86e3jrztm). The orbits are 12 apart and a glyph is 21 across, so
  planets within a few degrees on neighboring orbits drew over each other.
  A glyph that would cover another planet's glyph or ℞ now stands off along
  its own orbit, two that would meet kept in their order
  (`src/lib/client/orbitGlyphs.ts`). Where its true place falls beside the
  glyph, a dot marks it, the orbit picked out from there to the glyph, under
  the glyphs so it covers no ink; where a neighbor's glyph sits on it (the
  middle of a tight cluster can't clear both neighbors'), a ring over the
  glyphs marks it instead (55 of the sample's 326 marks); nearer, the glyph
  still stands over its true place. The dial's trips blend each glyph from
  its layout where a trip sets off to where it ends, as Tonight's do, and
  the offsets grow in with the opening, so nothing jumps; the arrow keys go
  round in the order the glyphs are drawn. Over the sample's 1,115 nights a
  glyph moves on 603, by 22° at most. `e2e/sky.spec.ts` draws every glyph
  and ℞ again, outline and all, in the wheels' own font, and finds no pixel
  two planets share and each dot at least three quarters in view (in
  Chromium on a Mac, 17 Oct; CI runs the same checks on Linux), at 375 and
  1280px on Sunday, March 23, 2025, when Mercury and Venus, both
  retrograde, stood within 3° of the Sun, and on Jan 12, 2026, when Venus's
  and Mars's true places lay under a neighbor's glyph.
- **The wheels draw their glyphs in their own font,** Retrospect Sky
  Glyphs: the seven planets from Noto Sans Symbols and Symbols 2, and ℞
  from Noto Sans (all OFL 1.1), 1,488 bytes of woff2, the same bytes every
  run of `scripts/sky-glyph-font.py`. Apple Symbols isn't on Linux, Android
  or Windows, and on CI's Linux the fallback drew Mercury's ℞ into Mercury.
  The layout's circles are measured from this font's outlines. Only the
  wheels' planets, ℞ and natal planets use it (`.wheel-glyph`), and each
  wheel preloads it; glyphs elsewhere keep the machine's own, and a page
  with no wheel never fetches it. The other wheel (Tonight's, the sheets'
  and the landing's) now places its glyphs by .35em, as the Sky view does,
  not by the machine's font's middle. Its CSS
  is 274 bytes of the app's own (42,256 of 43,000).
- **The ℞ is 12.6px at 375px** (it was 9.4px), clear of its own planet's
  glyph, and a retrograde planet still says "retrograde" to a screen
  reader. The same check reads both on March 23, 2025 and on the calm first
  night, Sept 28, 2023, where nothing moves.
- **Play's flashes stay at two a second.** The event flash and a star's
  title were keyed by counts that could both be 1, and while they matched,
  React put the flash back on the page every frame (about 40 a second); each
  key now says which it is.
- **Roster 5.11.0 to 5.12.0:** no code change; Roster's own focus rings now
  show for the keyboard in Safari. Its stylesheet grew 550 bytes, so the
  bundle guard's Roster pin is restated (165,941 to 166,491); the app's own
  CSS is unchanged at 41,982.

### Skeletons on Roster's, and the dial's touch drag (15 October 2026)

- **The dial follows a finger again** (ClickUp 86e3qqbhp). On a phone, a
  touch drag that started on the Sky dial's drawing moved one step and froze:
  the drawing's own lost capture bubbled up and ended the press. The dial
  and Every night's year strip now let go only for their own capture.
  `e2e/dial-touch.spec.ts` drags with a real touch through Chromium.
- **Roster 5.8.0 to 5.11.0, and every loading skeleton on Roster's
  `Skeleton`** in the app's look: the warm fill, a 50% pulse over 1.6s, 14px
  corners on blocks and pills for text lines. Each one is drawn in the boxes
  and line boxes of what it stands in for, and the rows' skeletons sit on
  the row's own carousel. "Coming up in your sky" and the rest of tonight's
  sky (the Moon's card and the seven) now have one: they used to appear
  from nothing, and the rest of the sky pushed everything under it down
  146px. The share sheet has its own, with the browser's Share button where
  it has one. Measured on the made-up sample at 375 and 1280px wide (900px
  tall), Every night, the question, planet, night, song and share sheets,
  the landing's sheets but its answers sample, compare's sheet, the songs,
  wild-night and coming-up rows and the rest of tonight's sky land with no
  shift. `e2e/skeletons.spec.ts` holds back the data for the ones whose
  size doesn't follow their text, and checks nothing moves: the wild-night
  row, Every night's first month, the question and planet sheets (which
  fill the sheet), compare's sheet, and the share sheet at 1280px.
- **Against main, measured 16 Oct on builds of 5b9ec62 and this branch:**
  each skeleton that still shifts with the data moves less than on main or
  the same, within a pixel. On 16 Oct's sky, "Tonight, for you" +39 and
  +23px (main +57 and -32), the genre row +11 (+43 and +60), the habits
  panel -58 and +56 (+258 and +166) and compare's rows at 375px +89 (+143);
  Tonight's heading (+42.5 against +42.1 on two lines), the landing's
  answers sample (+197) and compare's rows at 1280px (+36) are the same.
  "For you" now draws two rows from 640px and three under it: over a year
  of nights, before any heads-up, it has one row on 34%, two on 38% and
  three on 28%, and the first cut's three rows at 1280px had shifted more
  than main's. Weighted over that year, it shifts 61 against main's 76 at
  1280px, and 102 against 101 at 375px.
- **The bundle guard's CSS is two numbers:** Roster's stylesheets
  (`style.css` and `tokens.css`) pinned at 5.11.0's exact 165,941 bytes and
  restated with each bump, and the app's own CSS, the rest, under 43,000
  (41,982 now), set from what the app should cost rather than raised to
  today's size (`check-bundle-shape.mjs` says why).
- **Three unit tests get their own 20s timeout:** two in `nasa.test.ts` and
  "keeps a record per zone" in `route.test.ts`. Each takes one to two
  seconds, and went past the 5s default on a loaded machine.

### Compare's question sheet on phones (12 October 2026)

- **The two words side by side at every width, and each side's sentences
  under its own name** (spec 8.8): one side after the other below 640px, and
  in two columns from 640px, as before (with both answers in, pixel for
  pixel). At 375px the sheet had squeezed each side's sentences into a column
  about 160px wide. Each side's name comes just before its sentences for a
  screen reader. Browser checks on a phone (touch, 375px) and at 1280px
  measure both layouts, a side still loading, and a side with no answer.
- **`agentRules: false`**: from Next.js 16.3, `next dev` writes an
  `AGENTS.md` into the project when it detects a coding agent. This app opts
  out.

### Next.js 16.4.0 and Roster 5.8.0 (11 October 2026)

- **Next.js 16.2.10 to 16.4.0, for security.** 16.2.10 carried 17 Next.js
  advisories, three of them critical. One is remote code execution in
  `next/og`'s `ImageResponse` on the Node.js runtime (GHSA-vcvr-r3jv-pc5j),
  which is how `/api/og` draws a visitor's `?u=`. `eslint-config-next` moved
  with it. Every share card, at both sizes, renders pixel for pixel as it
  did locally, and the generic cards match production's. Client JS fell
  213,077 bytes (13.5%) with no source change, from Turbopack's shared
  runtime and export mangling, so the bundle guard's JS ceiling came down
  with it; its CSS ceiling went up for Roster's stylesheet
  (`check-bundle-shape.mjs` says why).
- **Roster 5.2.0 to 5.8.0.** The fields leave their invalid state to Roster
  (5.2.1), so the five hand-set `aria-invalid` props are gone, and "Remove"
  and "Check again" use `isLoading`, which keeps focus since 5.5.0. The
  landing's "What you get" and the reveal's counts sit tighter, from 5.8.0's
  line heights.
- **Left for their own review:** `sky-card` onto the shape tokens, and the
  hand-rolled skeletons onto `Skeleton`.

### Whole periods for the four periodic questions (6 October 2026)

- **Mercury retrograde, the full moon, the new moon and the strong Moon**
  now turn each rotation on its own circle: whole periods of the condition
  plus a seam drawn for that rotation, with the sky's own windows filling
  the time past the history (spec 6.1a). On 6.1's rule their windows lined
  up with themselves at offsets that shifted as a history grew, so a few
  more days of plays could flip a word. Venus retrograde and the other seven
  keep 6.1's rule.
- **Measured on the final tree:** with the engine as shipped, 7.1% of 1,000
  made-up histories with no sky effect get any Yes, against the 13% bound
  (8.3% on 6.1's rule). Words that flipped after 1, 3 and 7 more days on the
  four questions: 2, 4 and 4 on made-up histories (7, 16 and 22 before), and
  none on a real listener's history (1, 1 and 3 before). A planted full-moon
  effect still reads Yes.
- **The analysis version went to 3**, so stored answers recompute in the
  background, without "Checking". The made-up sample's full moon moved from
  Maybe to Not clearly, and its reveal line with it.

### Answers need a zone, and the null test in CI (5 October 2026)

- **`/api/user/{name}/answers` without a `tz`** gets a 400 (`tz_required`)
  and stores nothing. Before, it stored a UTC record no page asked for. A
  zone that's named but refused still reads in UTC, as before.
- **The null test runs in CI** (`.github/workflows/null-test.yml`): 1,000
  made-up histories with no sky effect, failing when more than 13% get any
  Yes. It runs on pull requests that touch the engine, the answer rule or
  what they import, every Monday, and by hand.

### Compare and the share cards (4 October 2026)

- **Compare, `/vs/{a}/{b}`**: "Same sky, different people." Both histories
  sync and are checked as today, each side's words corrected across its own
  tested questions. The 12 questions are rows, both words side by side with
  the swing under each ("A 23% bigger after-midnight share", new in the
  answers payload). A row whose words differ opens a two-column sheet
  (`?q=`). No winner and no score. Too early, not checked, private, missing,
  empty or failed shows in that side's column only; the same listener twice
  says so, with the two fields. A side being checked again swaps its new
  words in, as on the listener's page.
- **Share cards, `/api/og`**: song, night and question cards at 1200 by 630
  for unfurls and 1080 by 1920 for "Save image", read from the stored record
  and stored answers in the sharer's zone, never computed. With nothing
  stored, the generic card: the name and tonight's Moon. A question card
  never shows its word without its question, asked in the first person. The
  glyphs come from the cards' own font, a 5,000-byte subset of Noto Sans
  Symbols and Symbols 2 at Private Use code points (the renderer ignores
  U+FE0E), beside a Geist Latin subset, so a card fetches nothing. The
  busiest card is 184,618 bytes, and a 308,616-play history's cards take 33
  to 78 ms, against 10,637 ms for the old route.
- **The share sheet**: the 9:16 card itself as its preview, what it says, and
  "Save image", "Copy link" ("Link copied." in a polite live region) and,
  where the browser has it, "Share…". Links carry the sharer's zone, and
  `/u/{name}` unfurls as the card its link names.
- **Deleted**: the report route and its builder, `likelihood.ts`,
  `Versus.tsx`, the orphaned phenomena module, the exports only they used,
  and the report's `.rise` animation. The README's "How the math works" now
  describes the 12 questions.
- **Browser checks**: a second synthetic listener, "newcomer" (the sample's
  first ten weeks), for Compare's one-sided Too early. The offline guard lets
  `data:` URLs through: `next/og` loads its WebAssembly that way, and
  refusing it failed the run's teardown.
- **The sky guard's control**: the postbuild check that the sky data stays
  server-only proved its scan could see client code with the old client
  ephemeris, which this phase deleted, so every build failed it. It now
  proves it with the last night the planet links accept.
- **The bundle**, fc86afd's build against this one: guard JS 1,734,027 to
  1,581,812, CSS 193,163 to 193,054. `/vs/` first load +6,510 bytes (Roster's
  Sheet and inputs), `/u/` +274.

### Sky (3 October 2026)

- **`/u/{name}/sky`**, the third view: the planets on their own orbits at
  their real longitudes, your songs as stars on a spiral outside the signs
  (each where the Sun was at its first play), and a dial under it: plays per
  night, the Moon's light, ticks for storms, X flares and eclipses, a mark at
  each wild night. Drag it, tap the track, use the keys, jump to a wild
  night, go back to tonight, or play your years in 15 seconds; letting go
  within 6 nights of a wild night snaps to it with a card that opens the
  night. A planet tapped tints the signs by its standing, with a legend.
- **The Orrery's look and opening**: glyphs centered in their halos, the
  Sun's and Moon's glows, ticks every 5° on the sign ring, stars with the
  prototype's glow and sparkle, and a comet at the dial's moment joined to
  the Sun. On a visit's first view the planets wind into place the moment
  tonight's positions arrive (never held for the stars; off screen then,
  they simply show), the spiral draws in and the stars fly in as they load,
  still within 5 seconds. Stars twinkle
  only while "Play your years" runs, and ease to rest when it ends. The spiral is sampled smooth
  (a point every 2.5° or so) and thins as its turns crowd, so 16 years read
  as fine lines with the last year brightest, not one gold band. The dial's
  waveform is smoothed over about a week and topped at the 98th percentile,
  so one huge night can't flatten a history; the Moon's wave fades out once
  its months are under 3px apart. Every wild night keeps a fine tick, the
  wildest a mark; the ring around the center is as wide as the night's plays,
  averaged over a week either way while the sky moves so it doesn't flicker.
  The opening runs only with a fifth of the wheel on screen as the planets
  arrive, and waits for the reveal to close; any input stops it, the stars too, and the press that stopped it
  opens nothing.
- **A planet's sheet on a past night**: tapped while the dial stands on a
  past night, it's that night's planet at 9 p.m., titled "Venus on Sept 28,
  2023", never "tonight", and what came after it says its year
  (`?planet=venus-2023-09-28`, and the planet route's `night`). Any date in
  the sky data, 2002 through 2035, opens on every view; outside the
  listener's history the sheet is the sky alone, and a date outside the sky
  data says so. Play stopped rests the wheel on a whole night, so the wheel
  and the sheet agree.
- **The sky in the browser, after the first paint**: the shared sky module
  (one `bodiesAt` for the routes and the wheel) and astronomy-engine,
  49,497 bytes, load once the view has painted; tonight's first frame comes
  from the server. Sky's first load is 801,117 bytes, under Tonight's.
- **The travel is Tonight's**: `trips.ts` now goes into the past, jumps while
  the dial is dragged, and says where the wheel is in time.
- **`GET /api/user/{name}/dial`**: the whole history in one small answer
  for the dial, asteroids as bare offsets.
- **The birth chart is a sheet (`?chart=you`, Sky only)**: today's panel,
  loaded with its sheet, its signs and positions now the sky module's, its
  controls 44px, its natal planets drawn just inside the signs.
- **The sync's oldest play is the first play**: set from the stored history
  when a backfill finishes or an older state first refreshes, so the planet
  sheet and every other reader agree with the nights route.
- **From review**: a link's `tz` the server refuses no longer crashes the
  view; keys pressed mid-trip step from where the dial is going; flashes
  come at most two a second; a focused planet shows its own two-tone ring
  on Sky and Tonight, no longer a square box; term buttons like "Kp" are
  44px wide.
- **The bundle guard**, re-baselined: JS to 1,804,000 (1,733,273 measured),
  CSS to 201,000 (193,163), what grew written beside them.

### Every night (3 October 2026)

- **`/u/{name}/nights`**, the second view: every night as a door, newest
  month first, with the sky filters and "Your genres", a year strip that
  becomes a histogram with a filter on, and a dock that names the count, the
  question's own stretches for storms and flares, and the question that tests
  the filter. Months fetch a year at a time as they near the screen.
- **The switcher has two links**, Tonight and Every night. Its labels not
  selected read 6.2:1 on the track (3.34:1 before), the selected 8.6:1, both
  measured on the real switcher (ClickUp 86e3h9mca).
- **The server's half**: wild nights carry whether the zone saw the eclipse;
  a storm's stretch is question 7's own event, so the dock and the question
  can't disagree; the X flares NASA logged join the counts; the nights route
  sends each filter's and genre's nights per month once a visit, with the
  first year the calendar loads (`counts=1`), not with every year, and a sky
  filter with a genre over the whole history; the dead server chips are gone,
  their day words tested through the sky facts. The landing's month files no
  longer carry those counts: 416,480 characters, from 502,567.
- **The landing sample's storm count shows**: NASA's log fixture gained its
  storms' starts (DONKI read again 3 Oct, its readings unchanged), so the
  reveal counts 63 solar storms, where it said 0.
- **A night's sheet** steps between lit nights with a filter on, reads a year
  the calendar already has, and opens tonight before its first play.
- **The fluke meter says what it measures**: each notch is its phrase whole
  ("Unlikely to be chance"), under a line asking whether it could be chance.
- **From review**: the filter chips are a Roster `Carousel` with overlay
  arrows; an invalid link says so in a Roster toast, loaded on first use; and
  a night before the sync status's `oldestUts` (which can trail the first
  play) no longer closes as it opens. The switcher and filter bar stay in
  view as you scroll, with a "Back to top" button once a screen has gone by;
  the whole header shows at rest, and scrolled, the wordmark's row goes up
  and away: 165px stuck at 375 by 812 (at most 168px), from 245px. A Tab
  onto the sticky top's controls no longer scrolls the page under them (it
  moved about 400px a Tab), and the wordmark, scrolled away, comes back
  while it has focus. A visit that runs past a month's end keeps its years.
- **A filter dims the fill, not the date**: a dark night's fill, Moon and
  badges go to 35% and its date stays whole, 12.54:1 at the lowest (4.5:1
  needed), measured in the browser checks with every layer's opacity.

### Browser checks in CI (3 October 2026)

- **Playwright on the built app**, served from a fresh folder holding only the
  landing's made-up sample listener; the checks refuse to run beside env files
  or with R2's variables set.
- **What it checks**: the fold on a phone, "Surprise me" against every "for
  you" row at 375, 639, 640, 800, 1123, 1124 and 1280px, 44px targets with a
  planet tapped 21px from its center, and the selected tab's contrast (ClickUp
  86e3h9mca).
- **CI builds the app now**, so both bundle guards run on every pull request.
  The CSS ceiling goes to 192,000 bytes (183,362 measured).

### The Tonight revision (3 October 2026)

- **One list for you.** The chip row is gone. "Tonight, for you" sits under
  the wheel: each row the sky ("Venus is in Scorpio, in her detriment") over
  the answer and when it was measured, the question named ("Question 10:
  Venus in detriment"), never a bare number. Sky facts fill it to three. On a
  375 by 812 phone its first row starts at 586px, 680px in the spec's worst
  case; it was 864px.
- **Two halves.** Tonight's sky, the Moon, Earth, "All seven" and coming up,
  then "{Length} under the sky" over the 12, songs, wild nights, genres and
  habits. No switcher until there are two views.
- **Facts look like facts.** Labels are solid; rows carry a chevron and cards
  lift; the wheel says "Tap any planet." with a key for its halos; drawn
  skies show the real Moon or none; the fluke meter fills from the left and
  left the grid.
- **Rows a mouse can move**, as Roster 5.2.0's `Carousel`, with arrows beside
  "See all"; the night's photos one at a time with "2 of 5".
- **Motion, 8.11's six.** The wheel travels to a coming-up moment and back
  along the planets' real paths (`/api/sky/path`); rows light their planet;
  the heads-up planet pulses three times; the planets arrive; "Surprise me"
  fades in on a phone once the list is above it; a Too early jar fills.
- **The server's half**: sky lines, the heads-up's two lines, pairing chips
  that name the question's sky, a night's sign changes and stations with
  their times, eclipses the zone couldn't see ranked below G4 and G5 storms
  (from IANA's zone tables, tzdata 2026b), one card per event, and the
  wildest night's date.
- **The fill says when it's running**: `/api/space/progress` shows `running`
  from a pass's start, since a pass records itself only at its end.

### NASA's fill, by priority (2 October 2026)

- **A longer pass.** The space cron gets Vercel Hobby's 300 seconds (with
  Fluid compute, on by default) and fetches for 270, up from 35.
- **The wanted days first.** EPIC fills the days around storms, X flares,
  eclipses and asteroids of about 50 m closer than the Moon, and the last 12
  months, before everything else, each newest first.
- **Readable progress.** Each full pass records its calls, writes and what's
  left by source at `/api/space/progress`, and the cron's log line says what's
  left too.
- **The Sun per event moment.** SDO keeps the picture nearest every X flare's
  peak and every Kp reading's middle, not one per UTC day, so a night shows
  the one nearest its own biggest event: Chicago's May 11, 2024 now shows the
  X1.5. SDO's backfill starts again under a new index.
- **Coverage words.** A storm or flare night before 2016 says "NASA's daily
  Sun photos start in 2016."; after that, a night without a Sun says nothing.

### Tonight's follow-ups (2 October 2026)

- **The Sun on the right night.** SDO files a picture under the UTC day of
  the event it aims at, so a night now shows the picture taken during it, by
  the listener's clock (ClickUp 86e3jdkeg): Chicago's May 10, 2024 shows the
  X5.8 at 8:26 p.m., and May 11 no longer shows it. Two in one night: the one
  nearer that night's biggest X flare, or strongest storm reading. The
  landing's May 10 sample shows the X5.8 too. ~~A storm night no stored
  picture was taken in now shows no Sun (Chicago's May 11, 2024): the fill
  keeps one picture per UTC day.~~ Superseded the same day by a picture per
  event moment (NASA's fill, by priority, above).
- **Wild cards keep their photos.** One night's facts that won't read cost
  only that card's photo, and EPIC's index is read once per request.
- **The reveal never says "Too early for all 12"** while some questions are
  still being checked: "No answers yet: 10 need more history, two are still
  being checked."
- **NASA's log unread**: the "none overhead" line leaves storms and flares
  out and says why, with no count.
- **One set of day words** for chips, heads-ups and the "none overhead" line
  (`src/lib/listener/when.ts`), counted from the night the heading names: at
  1 a.m. Tuesday, Monday afternoon and the rest of the night are "today". A
  test fails if a second copy appears.
- **A history's length is never rounded up**, through one function: ten
  years and nine months is "Ten years", and the answers' "in your 10 years".
- **The habits' copy follows 9.2**: "4 a.m." and "6 p.m." in the badges and
  the hour chart, whole percents ("less than 1%" under half of one), and the
  pending sentence's month in the listener's zone.

### Tonight, the sheets, the landing and the reveal (2 October 2026)

- **Tonight replaces the report** at `/u/{name}`: tonight's sky as a wheel
  with dignity halos, the Moon, up to three chips, the questions whose skies
  are overhead with their short lines and one heads-up, then rows for your
  songs' skies, wild nights, what's coming up, genres, the 12 questions,
  compare and your habits, and "Surprise me".
- **Sheets are URLs**: a song, a night, a question, a planet and sharing open
  in Roster's `Sheet` from a search parameter, pushed with `pushState`. Back
  steps one sheet; close closes them all; a deep link closes to the view.
- **A listener shell** in `app/u/[username]/layout.tsx` holds the sync, the
  sheet host and the view switcher (Roster's `LiquidNav`, its active ink
  measured 8.60:1 on the gold pill, up from white's 2.10:1). The reveal shows
  once per username per browser, then the first-visit guide.
- **The server words what Tonight shows**: the sky's heading, Moon line,
  chips and planets on `/api/sky/now`; a planet's sheet on `/api/sky/planet`;
  wild-night cards and the "Surprise me" pool on `/highlights`; the reveal's
  last line on `/answers`; the habits' pending sentence on `/profile`.
- **Deleted**: the report, the sweep, the grip meter, the astrology corner,
  the timeline, the sky calendar and the old reveal's cards. The threshold
  slider went with the report, which closes the quality item that it was
  still a native input.
- **The landing says what it is.** The wordmark at full size, a plain line
  about what Retrospect does, then the username, then NASA's EPIC photo of
  the Apr 8, 2024 eclipse with a caption tying it to the sample, then four
  working samples, each badged "Sample". The sample listener is a less poppy
  made-up history, committed to `public/samples/`, with NASA's real photos of
  Earth and the Sun on its nights and JPL's flybys across its history.
- **The samples read the same on every Node version.** The Moon's angle (to
  0.01°) and lit fraction (to the whole percent), and an asteroid's size (to
  six decimals), are rounded where they're computed: their last digits came
  from trigonometry and powers that differ between Node versions and
  platforms, so CI's Node 22 wrote different ones than Node 24. A test reads
  every sample for longer ones.
- **Roster 5.1.0**, for `Sheet` and `LiquidNav`.

### Questions 5 and 6 test their folklore (1 October 2026)

- **What the lore says, measured.** Question 5 (Strong Moon) measures old
  favorites, the lore's comfort, memory and home, after a year's warm-up;
  question 6 (Venus and Mars getting along) measures how much you listen.
  Question 9 keeps after-midnight plays. Eight of the 12 need no warm-up.
- **Eleven new stories**, from Blake's folklore material, with every claim
  about people attributed to the lore. Question 3's stays general.
- **Never write, enforced.** A test reads every kind of sentence the answers
  endpoint returns, and every story, and fails on a mechanism word or on a
  clause that opens on a word outside its approved list. Tonight's heads-up
  no longer says a planet "did" something.
- **Reseeded.** The analysis version went to 2, so all 12 drew new shuffles.
  The full null test, run locally on 1,000 synthetic histories: 9.4% got any
  Yes, within the 13% bound (8.0% at version 1).
- **A changed question is checking, not mislabeled.** Each question stores
  what it measured. One stored under another measure (version 1's questions
  5 and 6) reads "Checking" on its own until it's recomputed; the other 10
  serve exactly as stored.
- **One line for a first year of Moon visits.** Two or more first-year events
  for old favorites share one early-read line.

### Nights, songs, highlights and genres as facts (1 October 2026)

- **Every night, served.** `/nights` gives up to a year of nights in the
  listener's zone: plays against a usual night of that weekday, the songs
  first heard, the Moon at 9 p.m., the questions and filters that held, the
  wild title, the genre mix and NASA's facts with the night's photos.
- **Songs, highlights and the sky.** `/songs` picks the 12 to show (and 50 to
  list) by spec 7.5, each with its chip and pairing sentence; `/highlights`
  serves the reveal; `/api/sky/at` and `/api/sky/now` serve any minute's sky
  and what's coming up.
- **Stored like the answers.** One record per listener and zone, a
  registered per-listener key, recomputed after the response when anything
  it was built from moves. The answers now carry each question's pairings,
  with the same seeds.
- **Genres are facts now.** The genre-versus-sky test, its headline and its
  forecast are gone, and so is the panel that showed them; the tags stay and
  become each genre's share, top artists, "rising" and biggest night.
- **Not yet:** no page calls the new endpoints; phase 3 does.

### NASA's data, and questions 7 and 8 (1 October 2026)

- **Stored once, for everyone.** DONKI's storms and flares, JPL's close
  approaches and fireballs, EPIC's Earth, SDO's Sun on storm and flare days,
  and APOD's titles, a file per source per month under `space/`. It's a
  shared prefix: no names in it, and removal and expiry leave it alone.
- **It fills itself.** The daily cron runs a 35-second pass, DONKI first, and
  the answers route runs a DONKI-only pass after its response when the log is
  missing or stale. No backfill by hand, and no NASA key: DONKI moved to CCMC
  on 30 Sept and needs none.
- **Questions 7 and 8 answer.** They test whole storm and X-flare nights in
  the listener's zone, only inside NASA's log: April 2010 to the start of the
  day 3 days before its last refresh. A Kp reading never covers time before
  its storm began: early storms (2010 to mid-2013) time their first reading
  at the moment they began, and reading it the modern way put 1 to 6 nights
  per zone before storms began. Stored answers recompute when what NASA
  logged changes or coverage reaches a new day, not on every refresh. The
  null test now runs all 12 against the real log.
- **Nothing logged late is lost.** A month is read again until it's been
  read a week after it ended, and the log counts as whole only up to that
  read. One failing day, month or row no longer stops a source's backfill.
- **APOD without the picture.** Its new source can't say what's public
  domain, so the page shows the day's title, credit and a link. That also
  fixes production's APOD line, which had shown NASA's logo under the wrong
  caption since the old API broke.
- **Curated photos and superlatives.** `src/data/space-photos.json` and
  `space-events.json`, each entry checked against its source; round 2's "the
  same storm lit up Mars" and "as far south as Florida" didn't survive that.

### The answers engine, and stored answers (1 October 2026)

- **The 12 questions, in one pass.** `/api/user/{name}/answers?tz=…` answers
  all twelve for a listener and time zone and stores them. It rotates the
  sky's windows instead of the plays, which gives the old test's counts
  exactly (a test holds the two together) in about 1.6 s for 500,000 plays,
  locally; step 0 timed the old per-play loop at 160 s for the same work.
  Events merge as the spec says, so Venus backing out of Aries and returning
  during her 2025 retrograde is one stretch.
- **A Yes allows for asking several questions.** It needs Benjamini-Hochberg at
  10% and its own p under 0.05. `npm run null-test` runs the 12 on 1,000
  made-up histories with no sky in them and fails above 13% with any Yes; the
  suite runs 100 quick ones.
- **Stored, and current.** One record per listener and zone, served at once
  and recomputed in the background when the history grows. It's a registered
  per-listener key, so removal and expiry cover it, and a removal that lands
  mid-compute takes the write back. The endpoint returns every sentence the
  page shows.
- **Not yet, then:** solar storms and flares read "Not checked yet" until
  NASA's data arrived (step 4, done since), and pairings come with the songs
  (step 5). No page calls the endpoint yet.
- **Smaller histories.** The chunk that finishes a backfill drops the
  duplicate lines a backfill keeps: a local copy of the largest history went
  from 11.0 MB to 8.6 MB. Histories already read keep theirs until a backfill
  runs again.
- **A preview can't touch production's data.** A deployment that isn't
  production refuses the production bucket, so nobody has to check a
  preview's settings by hand.

### Real time zones, and nights (30 September 2026)

- **The listener's zone, not one offset.** The profile read a whole history at
  the offset the browser had that day, so in summer every winter play in
  Chicago landed an hour late, and in winter every summer play an hour early.
  The browser now sends its IANA zone, and each play is read with the offset
  in force when it was played, daylight saving included, under the rules of
  its year (the US moved its dates in 2007; Brazil dropped daylight saving in
  2019). `src/lib/zone.ts` finds a zone's offset changes once per year and
  binary-searches each play: asking `Intl` about 500,000 plays takes 1.4 s on
  its own. The profile runs faster than it did, not slower.
- **Nights.** A night runs 4 a.m. to 4 a.m. and is named by the date it
  starts on, so a 1 a.m. Saturday play is Friday night's. The profile's
  busiest night, streak, weekday and loudest month count nights.
- **No zone, no guess.** A missing or refused zone reads the history in UTC
  and the response says so (`zoneFellBack`), for the redesign to tell the
  listener. A browser that is on UTC isn't flagged.
- The report route keeps today's single offset until the redesign's answers
  replace it. First-load JS: `/u/[username]` grows 21 bytes, the rest not at
  all.

### The sky through 2035, and the redesign's sky data (30 September 2026)

- **No more January 2027 cliff.** Today's ephemeris ended with 2026, and from
  10 Jan 2027 (Mars stationing retrograde) reports would have counted new
  listening as outside skies that were happening. The five files now run
  through 2035, and 2002-2026 is byte-for-byte unchanged. The landing's
  calendar shows the next Mars retrograde and the next eclipse again. A test
  fails once any sky data covers less than a year ahead. Costs 27,769 bytes of
  first-load JS on `/`, `/u/` and `/vs/` until the redesign drops these files,
  and the bundle-shape guard's client JS rises 55,538 bytes to 1,671,074 (it
  counts every copy of a chunk). The guard's ceiling goes from 1,694,000 to
  1,751,000, restoring its 4.8% slack.
- **The redesign's sky data, server only.** Sign windows for seven bodies,
  retrogrades for five, full and new moons, eclipses and the Venus and Mars
  harmony windows, 2002-2035, from one data-free math module. Checked
  against USNO, NASA's eclipse catalog and JPL Horizons. It reaches no client
  chunk, and two guards (the import graph, and the built chunks) keep it
  that way.

### The store audit, and share cards that can't outlive a removal (30 September 2026)

- **What's in the store that nothing accounts for.** `scripts/audit-store-keys.mjs`
  lists every key (names only, nothing read or changed, no username printed)
  and reports any outside the four per-user kinds and the removal markers,
  by masked shape with counts, sizes and dates. `--local` is its positive
  control: a checkout with flat files from before the blob layout reports them.
- **Share cards.** They were believed to cache for a year, because `@vercel/og`
  sets `max-age=31536000`. They don't: `next/og` replaces that response's
  headers, and production sends `public, max-age=0, must-revalidate`, which
  Vercel's CDN doesn't cache either. The route now sets that value itself, and
  a test reads it off a real render and bounds any future value to a day.

### A way to remove your data, and an empty account that isn't a dead end (30 September 2026)

DESIGN.md promised a footer "remove my data" and history kept "no longer than
needed". Neither existed: nothing deleted, and nothing expired.

- **Remove my data.** A footer link on the landing and the report opens
  `/remove`: what's kept, for how long and what removing does, in plain words,
  then a field for the username. Typing it is the confirmation. The delete is
  a POST that repeats the name; no GET a visitor can reach deletes anything.
  Open to anyone with no sign-in (decided 27 Sept), because Last.fm keeps the
  history and the worst case is one re-read. Limited to one removal per name
  per day and 20 a day in all, counted with markers in the store so a burst
  can't slip past the limit. A removal while a sync is mid-read is refused
  until the read finishes, and anything still writing for the name when a
  removal lands (a sync chunk, a genre request) takes its write back.
- **Every per-listener key in one list.** `src/lib/store/userKeys.ts` names the
  four (scrobbles, sync state, genre tags, genre results), and removal and
  expiry read it. A test fails if any module reaches the store without being
  listed, or if a removal leaves any key with the name in it.
- **History expires.** About 90 days after a name was last looked up, one
  constant in `src/lib/retention.ts`, swept daily by Vercel Cron. "Last looked up"
  comes from the store's own write times, so a visit costs nothing extra.
  Needs `CRON_SECRET` set in Vercel, or nothing expires.
- **The empty account has a next step.** "Nothing to read yet." now says how
  to start scrobbling, links Last.fm's own guide, and has "Check again". An
  empty history is re-read after a minute instead of an hour, so plays show
  up when the person checks again a minute or more later.

### The report tells the truth about its own confidence (28 September 2026)

The numbers the report showed claimed more certainty than the data
supported, in five places. The shared change comes first: every verdict now
has a `status` (`tested`, `too-few-plays`, `too-few-events`, `no-comparison`,
`warming-up`), so every consumer can tell "not enough to test" from "tested,
and nothing there". Before, both were `significant: false`.

- **The p-value.** The scramble test dropped every shuffle that found none of
  the tagged plays inside the windows, so an observed zero could never be
  matched and printed "p<0.001", on 0 of 10,991 plays in one account. Those
  shuffles now count, and p is (matches + 1) / (shuffles + 1), never 0. P is
  out of every verdict sentence. By default a result reads as plain-English
  likelihood, in four bands from "very unlikely to be chance" to "could easily
  be chance", with the shuffles as a plain frequency. The last band starts
  where a lead ends (p 0.35), so a lead never reads "could easily be chance".
  P-values are a toggle in the skeptic's panel, kept in the browser, and
  appear beside the plain sentence with what they mean, only for a tested
  trial, and never rounded across a line the words depend on.
- **The sweep.** A lead or a conviction must now be a tested trial, so a
  withheld one can't surface as "-100% · a lead". The sweep counts as judged
  only the trials it tested, and says how many are waiting on more history.
- **Convictions on three events.** A verdict now needs 6 separate events as
  well as 500 plays, because plays inside one window move together. Six is the
  fewest at which the events alone could clear the 5% bar (see README). Below
  it, the page says so in plain English. It costs rare skies most: about two
  years of testable history for Mercury, ten for Venus, thirteen for Mars.
- **Windows "on you".** One definition, the windows overlapping your listening,
  on every path; step 2 says separately how many the test used. The reveal's
  "songs played when Mercury is retrograde" counts the same plays as the
  anthem. The reveal and the dashboard read a trial through one function, so
  they can't give it two verdicts a click apart.
- **Loudest month** compares plays per day in each calendar month against
  plays per day overall, over the days the history covers. A three-month
  history no longer reads +329%.

Also:
- The grip meter reads "Not enough to measure yet" for an untested trial
  instead of "No measurable grip".
- The duel labels an untested side "not enough to test" with no score, scores
  a round only when both sides were tested, says which floor a side missed
  (too few full moons is not too little listening), and no longer calls a duel
  with no scored rounds "a perfect stalemate". A tested, unremarkable side
  reads "within chance" instead of "no real effect".
- The share card and the sweep's tooltips use the dashboard's own reading, so
  a lead can't unfurl as "Mercury is innocent", and an untested trial gets the
  generic card.
- An untested trial's page no longer prints its ratio ("0.00×") as a result,
  and one with no ratio at all no longer reads "100% fewer" or "scrambled 0
  times" in the skeptic's panel.
- The verdict's withheld copy counts "the plays this measure can test", so it
  can't say "None of your plays" beside the reveal's "6,658 songs played".
- A flat result no longer reads "0% blips"; the null-result lines no longer
  say "well inside what pure chance produces" beside a likelihood of 1 in 17.
- The skeptic's histogram now draws the shuffles that found none of the
  tagged plays in the windows, at 0, and its axis no longer goes below 0. On
  an untested trial the panel no longer tells you how to read the line.
- "1.0 years" reads "1 year" wherever a length of time is shown.
- The genre panel's own scramble test had both defects. Its p could be 0,
  and dropping the shuffles with none of a genre inside the windows made p
  too small: in a synthetic history, a burst of folk that happened to land in
  one Venus window read p = 0.20 where the honest figure is 0.74, and the
  panel's headline is decided by p. It now uses the same rule and formula as
  the trials, and the stored genre analysis is versioned so returning
  listeners get it recomputed.
- A lead used to come with advice to narrow the era until it converted
  ("leads become convictions in focused slices", "worth chasing in a narrower
  era"), which is slicing until chance obliges. It now says what a lead is: a
  swing chance could still have produced, a maybe and not an answer.
- A too-few-events verdict explains the sky's pace calmly ("Venus goes
  retrograde about every 19 months, so…") rather than reading as a failure.
  Under the 6-event floor most visitors get this for Venus and Mars; the
  redesign gives them more to measure (see Next).

Left alone on purpose, as the redesign's: the 25-trial sweep and the genre
headline have no multiple-comparisons correction, so across 25 trials a
"very unlikely to be chance" conviction can still be chance; and the sign
table's claims.

Client JS over `main` at 99eac00, both built locally: 1,627,019 to 1,636,886,
up 9,867 bytes (0.61%). `/u/` +5,017, `/vs/` +4,387. Guard headroom 66,981 to
57,114.

### A young history gets a real report (28 September 2026)

The first visit of anyone new to Last.fm used to fail outright. Four fixes:

- **Under a year of history gets a report, not an error screen.** Three
  measures ignore the start of a history (the warm-up), and a history with
  nothing past it got `null` from `buildReport`, a 404 "No scrobbles synced
  yet" from the route, and a page asking whether the username was right. It
  now gets a report marked `trialStatus: "warming-up"`: "Too soon to tell" in
  place of the verdict, the month it becomes testable, buttons for the two
  measures with no warm-up, and every part of the page and the reveal that
  doesn't need one. The report cache is now keyed on the whole history, not
  its newest play, so a report built mid-sync (a link unfurl can ask for one)
  isn't served once the older plays arrive.
  `buildReport` returns a typed outcome, so no scrobbles at all, none in the
  chosen era, and too young to test are three different answers, and the
  profile and genre routes stopped saying "No scrobbles synced yet" too.
- **No visitor sees developer text.** Pages render plain English from a
  `code` and never an API's error text, on `/u/` and `/vs/` both, so "Is
  LASTFM_API_KEY set?" is gone. A mistyped username now says so: Last.fm
  answers it as HTTP 404 with its own error code in the body, and the status
  check used to throw before reading the code. A failed recompute, such as an
  era with no listening, now leaves the report up with a notice instead of
  blanking the page, and a link that opens straight onto an empty era offers
  to read all of it instead.
- **Habits that need a year wait for one.** Old favorites, first listens and
  reunions are withheld until 500 plays have passed their warm-up, the same
  floor a trial needs, and the profile says when each can start instead of
  reporting "Only 0%".
- **An empty account finishes syncing.** Last.fm reports zero pages for it,
  and the worker only called a sync done with at least one page, so the wait
  screen spun for as long as the tab was open. Zero pages now counts as empty
  when nothing has ever been collected and page 1 has come back blank twice
  in a row. A blank reply never moves the sync's place in the history, so a
  bad first reply can't pass for an empty account and a blank page partway
  through is read again instead of skipped for good. An account already stuck
  starts again from page 1.

One narrow change to the sweep: its summary used to say "All 25 trials came
back clean" however many trials it had skipped as untestable, which a young
history now reached on the same page as "Too soon to tell". It now counts only
the trials it could judge, and only blames history length for the ones still
warming up. Which trials become hits, and whether a withheld verdict counts as
judged, is unchanged.

Left alone on purpose, because they belong to the next item: the reveal's
window count, the sweep treating withheld trials as leads, convictions on a
handful of events, and `/vs/` labeling a missing round "no real effect". The
sweep one is newly reachable: a young history used to stop at the error
screen, and a 300-scrobble three-month history now reaches the sweep and gets
"Mercury Retrograde × Night Owl, -100%, a lead" from a trial the report itself
withholds.
`trialStatus` is where "not enough data" gets told apart from "tested,
unremarkable" when that work lands.

Client JS, summed across routes, over `main` at 1f8d285 with both built
locally: 1,616,209 to 1,627,019, up 10,810 bytes (0.67%). A visitor to `/u/`
downloads 8,226 of those and a visitor to `/vs/` 2,504. The bundle guard's
headroom goes from 77,791 bytes to 66,981.

### The bundle-shape guard (18 September 2026)

`scripts/check-bundle-shape.mjs`, ported from blakeb-dev and run as
`postbuild`, so every `npm run build` checks it, Vercel's included (a bare
`next build` doesn't). It fails the
build if Roster's barrel appears in a client reference manifest, if client JS
passes 1,694,000 bytes, or if client CSS passes 175,000. At merge those were
1,616,209 and 167,298, so about 4.8% and 4.6% of headroom. The CSS ceiling
matters as much as the JS one: Roster's stylesheet is 142,426 of the app's
CSS bytes and doesn't shake.

Why it exists: Roster 4.13.0 regressed a sibling app by 18.49% with every gate
green. Nothing else here can see that. Vitest never imports Roster, eslint
reads source and `tsc` reads types.

Mutations run against it, each confirmed to change its target: a barrel pin,
a renamed barrel, padded JS, padded CSS, a missing build and a renamed
`clientModules` all fail it, and a negative control passes. (PR 14 says eight;
it lists these seven.) A follow-up
(`c361dae`) gave the manifest sandbox `process.env`, which it needs to run on
Vercel.

Limits: all of this app's Roster importers are `"use client"`, so the barrel
check is a tripwire for a shape the app doesn't have yet. CI runs no build,
but Vercel's preview build does, so a guard failure shows as a red Vercel
check on the pull request. Nothing requires that check to pass before a
merge: `main` has no branch protection.

### Roster 5.0.0 (17 September 2026)

The declared range and the lockfile only; no source changed. 5.0.0 moves the
`"use client"` boundary onto Roster's component modules. This app was never
pinned by that boundary, so no change was expected. PR 13 says client JS was
byte-identical, but its figure was left as a placeholder, so no measurement
is on record. The next recorded figure, the guard's 1,616,209 the following
day, is 395 bytes over 4.13.0's 1,615,814, and nothing on record explains
the difference.

### Roster 4.13.0 (17 September 2026)

`^4.12.1` to `^4.13.0`, with no source changes. 4.13.0 emits one module per
source file and marks its module-scope calls as side-effect free, so unused
components shake out. Client JS went from 1,790,737 to 1,615,814 bytes, down
174,923 (9.77%), CSS unchanged. Of the saving, Roster's own unused components
are about 54%, unused Headless UI about 30%, and Radix about 10%; Radix left
the bundle entirely.

Two things it didn't do. CSS doesn't shake, so after this the stylesheet is
the larger Roster cost. And the saving is contingent: one Roster import in a
server component would make it a client entry and undo it. The bundle-shape
guard above is what now catches that.

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
with the gold hairline is reachable from `src/app/globals.css`. `inputClassName`
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
- [x] ~~**The threshold `<input type="range">` in `Report`.**~~ Gone with
      `Report` in the redesign (spec 4).

Not visually verified: the `/u/{username}` report page. The two era month
fields, the slider, `replay the reveal`, `GenresPanel`, `SkyScan` and
`StoryIntro` are typecheck- and build-clean with every layout class preserved,
but no report finished syncing during the work. Worth an eyeball, especially
the `threshold` refactor.

## Next

### Product

- [x] **The redesign.** Done: its last phase, Compare and the share cards,
      landed 4 October 2026 (under Done). The
      young-history and confidence work left these for it rather than
      redesigning in passing:
      - Whether the 25-trial sweep and the genre headline get a
        multiple-comparisons correction, or are cut. Each trial is judged
        alone at 5%, so a sweep with no real effect anywhere still expects
        about one false conviction.
      - The sign table's claims: no row gets its own test, and rows rest on
        one or two events.
      - Blake's direction (28 Sept 2026, in the private finding): measure
        the sky every day, not only its rare events. Each planet's sign,
        dignity and aspects, and the Moon's phase and sign, with retrogrades
        and eclipses as one lens among several. Venus and Mars have to be
        first-class: through the signs they change state dozens of times in
        a few years, against one retrograde. Plus an honest early read for
        each rare event below the 6-event floor, labeled as too few to call
        a pattern.
      - A withheld verdict's explanation runs to seven lines in the hero at
        phone width.
      - A brand-new history under 500 scrobbles gets a thin page: no
        fingerprints yet, just a line saying when they arrive.
      - The genre panel shows "Reading the liner notes" for a while on a small
        history, then disappears without a word.
      - The anthem can rest on three or four plays.
      - The share card stays generic for a young history rather than saying
        "too soon to tell".
- [x] ~~**Deep-dive UX investigation.**~~ Delivered 27 September 2026 as a
      private finding with evidence. It shows real listening histories, so it
      stays out of this repo. Its follow-ups are the young-history and
      confidence work under Done, and the redesign above.

      The original brief, kept for the record: the app has a genuinely good idea in it
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

- [ ] **A NASA answers test fails from midnight to 2 a.m. UTC.** "Answers
      questions 7 and 8 from NASA's log" (`src/lib/answers/route.test.ts`)
      refreshes the log 2 hours ago, then 1 hour ago, and expects nothing
      new. The log's stamp starts with the UTC date it covers to
      (`compact.ts`), so across midnight it reads as new and the record as
      behind. Seen 27 Oct at 8 p.m. CDT, on `a46e3ef`'s tree too; CI in
      that window goes red. Pinning the test's clock to midday fixes it.
- [ ] **The sync's end isn't said under a shared link's sheet.** A shared
      link whose listener's history this visit reads (new, or out of date)
      opens its sheet in the same render that says "Listening history
      read", and the sheet hides the rest of the page from a screen reader,
      so it isn't heard. The sheet the link was for takes focus and is
      read. Found in review, 27 Oct, not measured.
- [ ] **Three "scrobble"s a visitor still meets.** Compare and the sync bar
      say plays (27 Oct), but the sync screen's quip "Counting scrobbles the
      old way, on an astrolabe…" (printed), the first song's star on the Sky
      wheel, named "…, your first scrobble …" (spoken), and the landing's
      credits, "Reads public scrobble data via the Last.fm API." (printed),
      don't. The empty account's "Last.fm calls this scrobbling" explains
      the word on purpose. A wording call for the UX lead.
- [ ] **A sheet closed as it opens can freeze over the page in WebKit.**
      Escape during a sheet's entrance (about 300ms), in WebKit under load,
      sometimes leaves Roster's Sheet half-closed: the URL cleared and the
      panel out of sight, but the dialog still mounted, with its full-screen
      container over the page, so every click lands on it until a reload.
      Measured 25 Oct in Playwright's WebKit, 4 workers: 1 to 3 of about 236
      Escapes, the panel left holding `data-enter`, `data-transition` and
      `data-closed` with nothing running: Headless UI never finishes the
      close. On macOS, 26 Oct: 5 of 143 Escapes during the entrance and 0 of
      47 after it, with frames still drawn and a mouse move not freeing it, so
      it isn't the image's frame stall (the 25 October Done entry). The Sheet
      runs the Headless UI Roster bundles, 2.2.9 in 5.15.0 (2.2.10 is out;
      untested here). Measured in Playwright's WebKit only, not confirmed in
      Safari itself. Roster's Sheet's to fix; the browser checks wait out the
      entrance meanwhile.
- [ ] **Three dev tools' advisories wait on npm.** `npm audit` lists vite
      (high, 5 advisories), vitest and @vitest/mocker (moderate), all fixed
      in range (vite 8.1.6 to 8.3.5, vitest 4.1.12), but npm 11.4.2 and
      10.8.2 both crash resolving them ("Cannot read properties of null
      (reading 'edgesOut')", on vitest's optional peers), by `audit fix`,
      `update` or `install` alike. `--legacy-peer-deps` gets past it but drops
      Roster's runtime peers (react-hot-toast, goober) from the lock, so not
      that. Dev only: `vitest run` opens no server. Retry with the next npm.
- [ ] **Every night's doors lose their focus ring in Safari after a click.**
      The arrow keys move focus between the doors by script, as the wheels'
      did (24 Oct, above), and the doors' rings are plain CSS
      (`.nights-cal .door:focus-visible`, globals.css), which Roster's
      `[data-key-focus]` mark doesn't reach, as the page's own square ring
      (`:focus-visible:not([tabindex="-1"])`) doesn't. Read from the code,
      not measured.
- [ ] **Loading shifts that need a design change.** What still moves when its
      data lands, measured 24 Oct on the made-up sample (data held, then let
      through), since everything whose size could be known first was fixed
      (24 Oct, above). Each is the data's own shape, so holding its room means
      holding the most the data can take, or a different design:
      "Tonight, for you" (+179.9px at 375, +117.9 at 1280 when the sky comes:
      its rows are tonight's sky, how many and how long; then +159.3 and
      +45.5 when the answers come after it and "Checking…" becomes each
      answer's line), "Your habits"
      (-58.5 at 375, +55.5 at 1280: how many archetypes, and how their lines
      wrap) and compare's rows (+89.4 at 375, +35.8 at 1280 over 12 rows: the
      swing lines). With a made-up photo of Earth, the rest of tonight's sky
      grows 122px when the sky comes on a day NASA's camera has one; the
      skeleton holds no room for it. Under 429px wide, the wheels' key takes
      a second line on a night with all four halos (23.5px; 7 of the 365
      nights from 25 Oct 2026). The row below is what was measured before.
- [x] ~~**Loading shifts that follow the data.**~~ Closed 24 Oct, but for the
      row above. Measured 15 and 16 Oct on the
      made-up sample: these still move when their content lands, because their
      size depends on tonight's sky, the hour or the listener's text, not the
      layout. Tonight's heading (one line or two at 375px, by weekday and
      hour: +42.5px on two), "Tonight, for you" (its rows follow tonight's
      sky: +39px at 375px, +23px at 1280px on 16 Oct), the genre row (+11px,
      the tallest card's text), the habits panel (-58px and +56px: how many
      archetypes, and how their lines wrap) and compare's rows (+89px and
      +36px over 12 rows: the swing lines). Compare's "Checking" line also
      leaves when its side lands (-45px), and on the Sky view something above
      "Your nights" grows 27.5px. The landing's answers sample, which never
      fills the sheet, opens on the short sheet skeleton and grows 197px. On a
      screen 1,300px tall, the question, planet and landing Tonight sheets
      don't fill the sheet, so their full-height skeleton shrinks when they
      land (-69, -215 and -319px at 1280px wide; before, they grew from
      459px). From 476 to 639px wide, the share sheet's words take fewer lines
      than its skeleton draws (-20 to -50px). By reading the code, not
      measured: Earth from NASA's camera lands inside the rest of tonight's
      sky on a day there's a picture; a row of one or two cards at 1280px
      shows no arrows, so its heading line is shorter than its skeleton's; the
      songs row's skeleton draws a title of two lines under 640px and one
      above, and a title can run to two either way; and the chart sheet keeps
      the short sheet skeleton. Each needs either space held in the content or
      a skeleton that knows more than the layout.
- [ ] **The nights API's bad-range 400s carry no code.** `from` after `to`,
      or months the wrong shape, answers 400 with only developer text, which
      a page would read as "Something went wrong on our side". No page puts
      the months in its URL, so only a direct API call gets there today; the
      report route this row used to name, with its hand-edited era, went with
      the redesign.
- [x] ~~A long name runs off the generic share card.~~ Set smaller and broken
      wherever the line runs out; fits at 1 to 50 characters, wide and tall,
      with no ink inside the frame's padding (21 Oct 2026, above).
- [x] ~~Framework error pages a visitor can still reach.~~ `not-found.tsx`,
      `error.tsx` and `global-error.tsx` in the app's own words, and
      `src/proxy.ts` for an address Next can't decode: 404 for a page, 400
      with a code for the API (21 Oct 2026, above).
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
