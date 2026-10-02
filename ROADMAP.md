# retrospect — Roadmap

**Index**

- **Done:** Tonight, the sheets, the landing and the reveal (2 Oct 2026) ·
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
- **Next, product:** The redesign: Every night (3b), Sky (3c), compare
  and the share cards (3d)
- **Next, quality:** framework error pages a visitor can still reach

## Done

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
  made-up history, committed to `public/samples/`.
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

- [ ] **The redesign.** Next, now that the live defects are fixed. The
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

- [ ] **Framework error pages a visitor can still reach.** There is no
      `src/app/error.tsx`, `global-error.tsx` or `not-found.tsx`, so a render
      exception would show Next's own "Application error" text. Nothing
      found triggers one today. A hand-typed URL with broken percent-encoding
      (`/u/abc%`) gets Next's bare "Internal Server Error", and a hand-edited
      era that runs backwards gets "something went wrong on our side", because
      the report route's 400s carry no `code`. None is reachable from the
      app's own links or forms.
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
