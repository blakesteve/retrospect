# retrospect — Roadmap

## Done

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
