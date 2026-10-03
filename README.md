<p align="center">
  <img src="public/retrospect-logo-tp.PNG" alt="Retrospect" width="120" />
</p>

<h1 align="center">Retrospect</h1>

<p align="center"><em>Your music taste vs. the actual sky. Entertainment with error bars.</em></p>

Retrospect turns your Last.fm history into a music horoscope backed by real math.
It cross-references every scrobble you've ever logged with real astronomical
events (Mercury, Venus, and Mars retrogrades, full moons, and eclipses, all
computed from planetary positions with [astronomy-engine](https://github.com/cosinekitty/astronomy))
and asks, honestly: does the sky change what you play?

Every verdict goes through a circular permutation test: your listening is
re-measured against thousands of scrambled event calendars, and an effect only
counts when chance is unlikely to have produced it. Astrology is the question;
statistics is the answer.

## What it does

- **Tonight**: tonight's real sky as a wheel, each planet at its longitude
  with a halo for its dignity and a key for the halos on the wheel, then
  "Tonight, for you": one list, each row the sky ("Venus is in Scorpio, in
  her detriment") over what your listening did under skies like it, the
  question named. Then the Moon, Earth from DSCOVR, and what's coming up,
  where "Show on the wheel" sends the planets along their real paths to that
  moment and back. Below a heading with the history's length come the 12
  questions, your songs, wild nights, genres and habits.
- **The 12 questions**: fixed, the same for everyone, each answered Yes,
  Maybe, Not clearly, No or Too early, in plain words, with how likely it is
  to be chance. The math is there for anyone who opens "Show the math".
- **The sky of your songs**: each song's sky the minute you first played it,
  the night it belongs to, and NASA's facts for that night.
- **Your wildest nights**, **what's coming up in your sky**, **your genres**
  (Last.fm's tags as facts, never linked to the sky) and **your habits**.
- **Every sheet is a link**: a song, a night, a question or a planet opens in
  a sheet with its own URL, so a shared link lands on it, in the sharer's
  time zone.
- **A reveal and a guide**: four cards the first time on a browser, then three
  tips; "Replay the reveal" in the footer shows the cards again.
- **Rows a mouse can move**: every sideways row is Roster's `Carousel`, so
  touch swipes, a mouse drags, and arrows beside "See all" page it where a
  pointer can hover.
- **Motion where the sky moves**, never on a result: the wheel's travel, the
  planets arriving on a first visit, a row lighting its planet, a heads-up
  planet's three pulses, a Too early jar filling. Everything that starts on
  its own stops within 5 seconds, holds still in a hidden tab, and under
  reduced motion the page is complete at rest.
- **Head-to-head**: two usernames side by side (rewritten in a later step).
- **The landing** says what Retrospect does and asks for a username first,
  then shows NASA's photo of Earth during the Apr 8, 2024 eclipse as an
  example, then four working samples. The samples are a made-up listener run
  through the real routes and committed to `public/samples/`; regenerate them
  with `WRITE_SAMPLES=1 npx vitest run src/lib/samples.test.ts` after any
  change to what the routes say (without the variable, the test fails when
  the committed files are stale). Their NASA photos and JPL flybys are real,
  fetched once into `scripts/sample-space.json` by
  `node scripts/sample-space.mjs`; the test fails when the samples show a
  month that file doesn't have.

## Run it locally

```bash
npm install
cp .env.example .env.local   # add your Last.fm API key (free: last.fm/api)
npm run dev
```

Open http://localhost:3000 and type a Last.fm username. The first sync of a
big library takes a few minutes (Last.fm rate limits); everything is cached in
`.data/` after that.

```bash
npm test             # analysis, answers, report, profile, zone, sky, sync, store and error-copy tests
npm run lint
npm run typecheck
npm run ephemeris    # regenerate today's UI windows, 2002 through 2035
npm run sky          # regenerate the redesign's sky data, 2002 through 2035
npm run null-test    # the answers' null-data test at full size, about a minute
npm run space        # fill or refresh NASA's data in the local store (--all for everything)
```

All three of the first ones run in CI on every pull request, which is new — the
lint errors they now catch had been sitting in the tree because nothing ran
them on the way in.

### A note on form controls

Controls come from Roster, not hand-rolled markup: sheets are Roster's
`Sheet`, rows its `Carousel`, the view switcher its `LiquidNav` (shown once
there are two views), a page-level fatal state its `EmptyState`, and fields,
buttons, pills, switches and disclosures its own. What Roster has nothing for
is the app's own, in `src/components/listener/`: the sky wheel and its travel,
the Moon, the jar, the meters' labels and the icon set. The pure pieces they
use (which "for you" rows show, the fluke meter's fill, the wheel's path math,
its glyph layout and the trip controller the Sky view will share) live in
`src/lib/client/` and `src/lib/motion/`, where tests reach them, and import
nothing that reaches the sky data. The threshold slider that used to be the exception is
gone with the report.

The UTC-offset field used to be the second exception, on the grounds that
Roster's menu had no scroll. That was wrong — Headless UI caps and scrolls the
panel itself — and what actually blocked it was theming, which Roster 4.8.1
fixed.

Roster's `Input` takes its surface, border, focus border and text from four
`--roster-control-*` variables, and floating panels take three more from
`--roster-popover-*`. Both are mapped in `src/app/globals.css` to this app's own
`--surface-1`/`--surface-2`, `--hairline`, `--gold` and `--text-primary`, in
**both** `:root` and `.dark`. Both scopes are load-bearing, not belt and
braces: `Select` copies the `dark` class onto its portaled menu, so Roster's
own `.dark` token block lands on that element directly and beats anything
inherited from `:root`. Set only `:root` and the trigger themes while the menu
comes back in Roster's grays. Point new controls
at `variant="outline"` and they inherit the palette. `className` lands on the
outer field wrapper — use `inputClassName` to reach the control itself.

### A note on error messages

Visitors never see an API's `error` text. It's written for whoever is
debugging, and it can name environment variables, storage settings or HTTP
statuses. Every error a page can show carries a `code` instead, and the page
renders the plain-English message for that code from `src/lib/visitorErrors.ts`,
logging the raw text to the console. Adding a new failure means adding a code
there, not passing a message through. A test checks every message for
developer text, and checks the page source for the old hints.

## Deploy (free tier, on purpose)

Retrospect is built to cost $0: Vercel Hobby for the app, Cloudflare R2 for
storage. R2 was chosen specifically because it has **zero egress fees**, so
the app's read-heavy access pattern can't generate a surprise bill, and
Vercel Hobby pauses rather than charges when limits are hit.

1. Create an R2 bucket (Cloudflare dashboard → R2 → Create bucket).
2. Create an R2 API token with read/write on that bucket; note the Account ID,
   Access Key ID, and Secret Access Key.
3. Import the repo into Vercel and set the environment variables below.
4. Deploy. Histories are stored as gzipped blobs (a 500k-scrobble library is
   ~7MB), so the 10GB free tier holds roughly a thousand heavy users.

| Variable | Required | Purpose |
|---|---|---|
| `LASTFM_API_KEY` | yes | Last.fm API access ([create one](https://www.last.fm/api/account/create)) |
| `R2_ACCOUNT_ID` | prod | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | prod | R2 API token key |
| `R2_SECRET_ACCESS_KEY` | prod | R2 API token secret |
| `R2_BUCKET` | prod | R2 bucket name |
| `NEXT_PUBLIC_BASE_URL` | prod | Absolute URL for share cards |
| `CRON_SECRET` | prod | Lets Vercel Cron run the daily expiry sweep and NASA refresh; without it nothing expires |

No NASA key: none of the sources Retrospect reads needs one since 30 Sept
2026, when DONKI moved to CCMC. `NASA_API_KEY` is unused.

`CRON_SECRET` is any random string of 16 characters or more. Vercel sends it
with its own cron requests, and both cron routes refuse every request without
it, so a crawler can't trigger them. Unset, they refuse everyone and log why
each day: stored history never expires, and NASA's data fills only from the
answers route.

Without the R2 variables, storage falls back to the local filesystem
(`.data/`), which is exactly right for development and self-hosting on a
normal server. Upgrading from an older checkout? Run
`node scripts/migrate-store.mjs` once to convert flat `.data` files to the
blob layout.

## What's stored, and removing it

Everything stored for a listener sits under six keys, all named in
`src/lib/store/userKeys.ts`: the scrobbles, the sync state, the genre tags for
their top artists (per listener, not shared), the answers to the 12 questions
(a record per time zone, in one blob), their nights, songs and genre facts
(the same, gzipped), and the old genre-versus-sky results, which nothing
writes any more but which removal and expiry still clear. The footer's
"remove my data" opens `/remove`, which deletes all six with a POST. No GET a visitor can reach deletes anything; the expiry sweep's GET
refuses anyone without `CRON_SECRET`. Anyone can remove any name, without
signing in: nothing is lost, since Last.fm keeps the history. Two limits keep
that from being abused, both in `src/lib/retention.ts`: one removal per name per
day, and at most 20 removals a day across every name.

Stored history also expires on its own, about 90 days after its name was last
looked up (`KEEP_DAYS`, the same file), once `CRON_SECRET` is set. Vercel Cron
calls `/api/cron/expire` once a day (`vercel.json`), and the sweep reads "last
looked up" from the store's own write times, so a visit costs nothing extra.

A removal can land while something is still writing for that name: a sync
chunk appending a history, a genre request fetching tags, a listener record, or the
answers being computed.
Each of those checks after its write whether the name was removed since it
started, and takes its write back if so.

NASA's data is the one thing stored that isn't per listener: it sits under
`space/`, the same for everyone (`SHARED_PREFIXES` in `userKeys.ts`), and
holds no names. Removal and expiry leave it alone.

`scripts/audit-store-keys.mjs` lists the store, names only, counts the shared
keys apart, and reports any key outside the five kinds, the shared prefix and
the removal markers: those are the keys removal and expiry never touch. It
reads no object and prints no username; `--local` runs it against `.data`.

Share cards (`/api/og`) are sent with `public, max-age=0, must-revalidate`, so
no cache that honors the header keeps one after a removal. Chat apps keep their
own copy of an image they've unfurled, which no header controls.

Anything new that stores something per listener gets its key in `userKeys.ts`
first, and takes its writes back after a removal the same way.
`userKeys.test.ts` fails if a module reaches the blob store without being on
the test's own allowlist, if an allowed module builds a key by hand, and if a
removal leaves any key with the name in it.

A brand-new Last.fm account with no scrobbles gets a page that says how to
start scrobbling and a "Check again" button. An empty history counts as fresh
for a minute, not the hour a history with plays in it gets, so someone who
plays a few songs and checks again a minute or more later sees them.

## The sky data

Two sets, both generated with astronomy-engine and committed, both covering
2002 through 2035. A test fails once either covers less than a year ahead.

- **Today's UI** reads `src/lib/ephemeris/*.json` (Mercury, Venus and Mars
  retrogrades, full moons, eclipses). Client components import these small
  files directly, until the redesign replaces them.
- **The redesign** reads `src/lib/sky/data/` through `src/lib/sky/windows.ts`: sign
  windows for the Sun, Moon and five planets, retrogrades including Jupiter and
  Saturn, full and new moons, eclipses, and the Venus and Mars harmony
  windows. About a megabyte, and **server only**: no client module may import
  it. `src/lib/sky/clientImports.test.ts` walks the import graph, and
  `scripts/check-sky-server-only.mjs` scans the built client chunks after every
  build.

The sign, dignity and aspect math is one module with no data in it,
`src/lib/sky/sky.ts`. The generator (`scripts/sky-data.mjs`) computes every window
with it, and the Sky view will import it, so the data and the live math can't
disagree at a sign boundary.

Accuracy, against published sources (details in `src/lib/sky/data.test.ts`):
eclipses within seconds of NASA's catalog, the Sun and Moon within about a
minute and a half of USNO and JPL Horizons, Mercury and Mars stations within a
couple of minutes. Jupiter and Saturn are good to about half an hour:
astronomy-engine's positions for the slow planets can be a few arcseconds off,
which is minutes to tens of minutes of their motion.

## Time zones and nights

The browser sends its IANA zone as `tz`, and the server reads every play with
that zone's real offsets, daylight saving included, under the rules of the
play's own year. `src/lib/zone.ts` finds a zone's offset changes once per year a
history covers and binary-searches each play, because asking `Intl` about
500,000 plays takes over a second. A zone is accepted if a formatter accepts
it and it's a named zone rather than a bare offset like `+05:30`. It's never
checked against `Intl.supportedValuesOf`, which leaves out UTC, Asia/Kolkata
and Europe/Kyiv. A missing or refused zone reads in UTC, and the response says
so with `zoneFellBack`. The `zone` a response names is a key, not a label:
aliases fold onto one name, often the old one (Europe/Kyiv comes back
`Europe/Kiev`), so pages show the zone they sent.

A night runs from 4 a.m. to 4 a.m. local time and is named by the date it
starts on, so a 1 a.m. song belongs to the night before. The profile
(`/api/user/{name}/profile?tz=America/Chicago`) counts its busiest night,
streak, weekday and loudest month in nights. The report route still takes
today's single offset (`tzm`) until the redesign's answers replace it.

## The 12 questions

The redesign asks every listener the same 12 questions (`src/lib/answers/`),
and `/api/user/{name}/answers?tz=…` answers them all in one pass: about 1.6
seconds for 500,000 plays locally. Each is today's rotation test below, run by
rotating the sky's windows instead of the plays, which gives identical counts
(`rotation.test.ts` holds it to today's per-play test) at a fraction of the
cost. Events merge as the spec says: Venus backing out of a sign and returning
during a retrograde is one stretch, not two.

Each question tests what its folklore says, two-sided. Eight need no warm-up;
the four measured by old favorites or first listens (1, 3, 5 and 11) wait out
a history's first year. Each carries a one-line story from the lore, and the
lore stays lore: any claim about people or feelings is attributed ("the lore
says", "is said to"). `neverWrite.test.ts` reads every kind of sentence the
answers endpoint returns, and every story, and fails on any mechanism word
("energy", "vibrations"). It also fails on any clause that opens on a word
outside its approved list, so a sentence of advice can't open the copy
unnoticed: a new opening word has to be added to the list by hand.

The answer word allows for asking several questions at once. A Yes needs the
question to pass a Benjamini-Hochberg false-discovery correction at 10% across
every question that was tested, and its own p under 0.05. Below that it's
Maybe, Not clearly or No by p alone, and a question without enough to test is
Too early. `npm run null-test` runs the 12 on 1,000 made-up histories with no
sky in them and fails if more than 13% get any Yes; the suite runs a quick 100.
Each history is seeded, so a run gives the same result every time.

Below the event floor, each event gets its own early-read row. For the
questions with a warm-up (1, 3, 5 and 11), two or more events in a history's
first year share one line instead ("27 visits in your first year, Jan 7 to
Dec 31, 2025, came before old favorites count."); the Moon is strong about
twice a month, so a history just past a year would otherwise list over 25.

Answers are stored per listener and time zone, with the history they were
computed from. A record that's behind (the history grew, the analysis changed)
is served at once and recomputed in the background. Each question stores what
it measured. One stored under another measure reads "Checking" on its own,
with none of its numbers, until it's recomputed; the rest serve exactly as
stored, their correction included. The endpoint returns every sentence the
page shows, built when it's served, so copy can change without a recompute.
Questions 7 and 8 (solar storms and flares) test only whole nights inside
NASA's log: from its first records in April 2010 to the start of the day 3
days before its last refresh, since DONKI logs late. They read "Not checked
yet" until the log is whole. A record counts as behind when what NASA logged
changes or its coverage reaches a new day, so the log's 3-hourly refreshes
don't recompute everyone's answers.

## NASA's data

`src/lib/space/` stores NASA's data once for everyone, a file per source per
month (`space/{source}/{YYYY-MM}.json`), each with the source's documented
first date and its last refresh:

| Source | What's kept | For |
|---|---|---|
| DONKI storms and flares ([CCMC](https://ccmc.gsfc.nasa.gov/tools/DONKI/)) | each storm's Kp readings; each flare's class and peak | storm and X-flare nights, questions 7 and 8 |
| JPL close approaches and fireballs | approaches within 0.05 AU; fireballs with their energy | a night's asteroid and fireballs |
| EPIC | each day's photos of Earth from DSCOVR, with where each faces | Earth that day |
| SDO | the Sun's AIA 171 image nearest every X flare's peak and every Kp reading's middle, from 2016, where its browse archive starts | the Sun on those nights: each night shows the picture nearest its own biggest event, by the listener's clock; a storm or flare night before 2016 says "NASA's daily Sun photos start in 2016." |
| APOD | each day's title, credit and page, never the picture | the APOD link |

Storm and flare times are kept in UTC, plus a compact list of every Kp reading
and X flare that the answers engine reads in one call; nights are worked out
per listener. A Kp reading covers the 3 hours before its time, as DONKI times
them since 2014, but never time before its storm began: up to mid-2013 a
storm's first reading is the moment it began, often off the 3-hour grid.

Nobody runs a backfill by hand. The daily cron (`/api/cron/space`) runs a
270-second pass inside Vercel Hobby's 300-second limit (`vercel.json` sets
Fluid compute, which that limit needs), most needed first: DONKI, then the
day's refreshes, then the backfill's wanted part (JPL's years, SDO's
moments, APOD's last year, and EPIC's days around storms, X flares, eclipses
and close asteroids and its last year), then the rest of APOD and EPIC, each
newest first. Vercel's "Run" button on the cron job starts a pass by hand;
a full pass holds a lease in the bucket while it runs, so a second press
during one skips rather than writing over it. `/api/space/progress` shows
each full pass's calls, writes and what's left by source, in a browser, and
`running` with the time a pass started while one is under way (a pass
records itself only at its end): wait for `running` to clear and
`updatedAt` to change before pressing Run again. A `running` that never
clears is a pass the 300-second limit cut short. The answers route also runs a DONKI-only pass after its
response when the log is missing or over 3 hours old, at most once per 5
minutes per instance; the cron waits for one running on its instance rather
than skip the day. CCMC limits DONKI to about 100 calls at once, refilled at
about 1.4 a second, so a pass stops with a few left and the next carries on:
the whole storm and flare log is 398 calls, about four passes.
`npm run space -- --all` runs passes until nothing's left, against whichever
store the environment names.

A month can still change until it's been read a week after it ended, since
every source logs late; until then it's read again (DONKI when 3 hours old,
the rest daily), and the log is whole only up to its oldest such read. A
day's refresh counts as due after 20 hours, since Vercel fires a daily cron
anywhere in its hour. A unit that fails is skipped and asked for again next
pass; a rate limit, a timeout or three failures in a row end that source's
turn. A row that won't read is left out and logged. SDO and EPIC keep an
index of what they've finished (SDO's event moments, EPIC's days), so a pass
doesn't read every month to find what's left, and EPIC reads its last 3 days
again daily, since it posts late.

APOD's new source can't say which pictures are public domain, so Retrospect
never shows one: `/api/apod` returns the day's title, credit and a link.

Two curated lists sit in `src/data/`: `space-photos.json` (NASA Image Library
photos of events, each shown only on its own event's night, captions saying
when they were taken) and `space-events.json` (the only superlatives the app
says, each with its source, the source's words, and when it said them).
`curated.test.ts` holds them to those rules.

A backfill keeps a play twice when Last.fm's pages shift under it, and reads
drop the repeat. The chunk that finishes a backfill now rewrites the history
without them, in the write it makes anyway: a local copy of the largest
history went from 11.0 MB to 8.6 MB. A history that's already been read keeps
its repeats until a backfill runs for it again.

## Nights, songs and genres

The redesign's other endpoints (`src/lib/listener/`) all take `tz` and read
one stored record per listener and zone, kept fresh like the answers: served
at once, recomputed after the response when the history, NASA's log, the
tags or the version moved. A first record for a 500,000-play history takes
about 0.3 seconds locally, before JPL's monthly files are read.

| Endpoint | What it returns |
|---|---|
| `/api/user/{name}/nights?from=YYYY-MM&to=YYYY-MM` | Every night of up to a year: plays against a usual night of that weekday, after-midnight plays, songs first heard (with pairings), the Moon at 9 p.m., every sign change and station during the night with its time ("The Moon entered Cancer at 10:12 p.m. CDT."; Jupiter and Saturn to the day), the questions whose condition held, with when for one that began or ended that night ("from 10:12 p.m. CDT"), the filters it lights, its wild title, its genre mix, and NASA's facts with its photos. Plus each filter's count over the whole history. |
| `/api/user/{name}/songs` | Your 12 most-played songs with 5 plays or more first played after your first 90 days, plus your first scrobble; "See all" lists 50. Each with its genre, first play, highlight chip, pairing sentence and the Moon's phase at that minute. |
| `/api/user/{name}/highlights` | The reveal: how long, the count-ups, the wildest nights as cards (plays against a usual night, the night's photo, the Moon's phase at 9 p.m.), one card per event, the wildest night's date ("Friday, May 10, 2024") and line, and the song with the strangest sky. Plus the "Surprise me" pool: song skies with a chip, wild nights, and dated facts. |
| `/api/user/{name}/profile` | Your habits, with the sentence for the ones still waiting built on the server, so no page imports the sky's windows. Noise is always left out. |
| `/api/user/{name}/genres` | Up to 12 genres with 50 plays or more: share, top artists, "rising" and biggest night. "building" while the tags are fetched. |
| `/api/sky/at?t=` | The sky at an instant, 2002 through 2035, cached for good. |
| `/api/sky/now` | The sky now, what holds tonight so far, and up to 6 things coming up in the next 45 days, each with the body it's about. Plus Tonight's words: the heading by local time, the time (with the weekday from midnight to 4 a.m.), the Moon's line with and without her sign ("Waning gibbous, 93% lit · 2 days after full, in Taurus, where she's exalted"), each held question's sky line ("Mercury is retrograde until Oct 13", "A solar storm tonight, Kp 7"), the sky facts that fill the "for you" rows ("Jupiter turns retrograde Saturday"), every planet's dignity, any mutual reception, the latest EPIC Earth within 3 days, and the row for a night with no question's sky overhead, with the next start. It still sends the old chips, which no page reads since the Tonight revision. |
| `/api/sky/path?to=` | The wheel's path to a coming-up moment at most 45 days out: every body's longitude from now (down to the hour) to `to` (to the hour), the Moon hourly and the rest daily, both ends included, to 0.01°. Cached until the hour turns. |
| `/api/sky/planet?body=&from=&to=` | A planet's sheet: tonight's sign and dignity, its dignity in every sign, its path through a history as a strip (the Moon's as a letter per night), its next station and sign change, and the questions about it. Jupiter and Saturn to the day, the others to the minute. |

A night runs 4 a.m. to 4 a.m. local. A question's condition holds on every
night its window touches, but the full- and new-moon filters light only the
night of the exact instant, and an eclipse the night of greatest eclipse.
Wild nights rank total solar, annular and total lunar eclipses seen from the
listener's zone, then G5 and G4 storms, then the eclipses the zone didn't
see, then flares of X5 or more and asteroids of about 50 m closer than the
Moon; a curated title (`src/data/space-events.json`) heads a night when one
matches, and the log's words otherwise. "Seen" means at least 10% of the Sun
covered with the Sun up, or the Moon up at a lunar eclipse's greatest moment,
at the zone's principal city from IANA's `zone1970.tab`, old names included
through its `backward` links (tzdata 2026b, from github.com/eggert/tz at tag
2026b, committed at `src/data/tz/`; `node scripts/zone-cities.mjs` turns them
into `cities.json`). UTC and Etc zones see every eclipse. It's a ranking rule
only, and no copy names the city. A storm that runs past 4 a.m. is one card,
on the night of its higher reading, though both nights stay wild. Pairings are facts with a time and a
date ("You first played Apple at 7:18 a.m. CDT on Oct 3, 2024, the minute an
X9.0 flare peaked."), never a cause, and the answers carry each question's
pairings.

A song first played in your first 90 days, your first scrobble included,
gets no chip and no pairing: its first play isn't news.

Genres are Last.fm's tags as facts about your listening. The genre-versus-sky
test, its headline and its forecast were claims with no correction, and are
gone with the panel that showed them; the tag pipeline stays. Any of these
routes moves the tag fetch on after its response, and `/genres` says
"building" until it's done, "failed" if it can't be.

## How the math works

Scrobble timestamps are joined against precomputed event windows (see
`scripts/`), and each measure tags plays (old favorite? first listen?
after midnight?) or counts volume. The index is the tagged rate inside
windows over the rate outside. Significance comes from rotating the event
calendar to thousands of random offsets, which preserves both the calendar's
structure and your listening's autocorrelation, and asking how often chance
beats you. Rare-event measures get a "lead" tier for effects that are large
but unconfirmed. Sleep-noise artists (rain sounds, ASMR) are always left out, so
eight hours of Rolling Thunder doesn't drown your actual taste.

The p-value is (matches + 1) / (shuffles + 1): the real calendar counts as one
possible outcome of chance, so p is never 0 and never claims more than the
shuffles can support (with 2,000 of them, the floor is about 0.0005). A shuffle
that puts none of your tagged plays inside the windows is the most extreme
thing chance can do, and it counts.

A trial only gets a verdict with enough to go on: 500 plays inside the
windows, and 6 separate events. Plays inside one retrograde move together (a
holiday, a bad week), so the events are the real sample size. Six is the
fewest at which the events alone could clear the 5% bar: if the sky did
nothing, all of five events agreeing happens 6.25% of the time by chance, and
all of six 3.1%. Below either floor a trial is untested: the verdict, the
reveal, the sweep and the duel say so, and the share card shows no verdict,
rather than any of them reading it as "nothing there". The API gives each verdict a
`status` saying which: `tested`, `too-few-plays`, `too-few-events`,
`no-comparison` or `warming-up`.

Three measures ignore the start of a history, because nothing in it can count
yet: a song can't be an old favorite a week after you first heard it.
Nostalgia and Old Flames skip their own threshold (365 and 548 days by
default), and Discovery skips the first year. A history younger than that has
nothing to test, so instead of a verdict it gets "Too soon to tell", the month
its plays start counting, and every part of the report that doesn't need the
warm-up: the timeline, the anthem, the listener fingerprints (from 500
scrobbles), and the two measures with no warm-up at all, Night Owl and
Intensity. The API marks such a
report `trialStatus: "warming-up"`, which is a different answer from a user
with no scrobbles at all.

## Credits

Listening data from the [Last.fm API](https://www.last.fm/api); astronomy from
[astronomy-engine](https://github.com/cosinekitty/astronomy); space weather from
NASA's [DONKI](https://ccmc.gsfc.nasa.gov/tools/DONKI/); asteroids and fireballs
from [JPL](https://ssd-api.jpl.nasa.gov); Earth from
[EPIC](https://epic.gsfc.nasa.gov); the Sun from [SDO](https://sdo.gsfc.nasa.gov);
photos from the [NASA Image Library](https://images.nasa.gov), credited each
time; UI atoms from
[@blakesteve/roster](https://www.npmjs.com/package/@blakesteve/roster).
Not affiliated with Last.fm. For entertainment purposes; the planets are not
responsible for your taste.

MIT © Blake Ball
