# retrospect — Roadmap

## Next

### Swap hand-rolled markup for Roster components

The app already imports `Button`, `Checkbox`, `Countdown`, `Disclosure`,
`LiquidTabs`, `MatchupCard`, `Select` and `Spinner`, but a sweep on 27 Aug 2026
still found **19 raw elements Roster has a component for**: 12 `<input>`,
6 `<button>`, 1 `<select>`. `UsernameForm` is the clearest case — it imports
four Roster components and then hand-rolls the username field sitting right next
to a Roster `Button`.

- [ ] Audit every `<input>`, `<button>` and `<select>` under `components/` and
      `app/` and replace what Roster covers. Start with `UsernameForm`, which is
      the most visible.

**Two things block the `UsernameForm` swap specifically**, and both are Roster
gaps rather than reasons not to do it. Filed in Roster's `CANDIDATES.md`:

1. **Roster's `Input` cannot be height-matched to its `Button`.** `Input` is
   42px, fixed by `py-2.5` + `text-sm`; `Button` is 40px (`default`) or 44px
   (`lg`). `Input` takes no `size` prop, and its `className` lands on the outer
   `Field` wrapper rather than the `<input>`, so the height is not reachable
   from outside. Every existing `Input` usage across the workspace is a stacked
   `flex-col` form where heights never have to line up, which is why this has
   not surfaced before.
2. **`Input`'s variants hardcode their border and background** rather than
   reading a token the way `Button` does. This field is deep indigo with a gold
   hairline (`rgba(212,175,55,0.28)`); the closest variant, `outline`, gives a
   transparent fill and an `--roster-gray-300` border. Its focus border does
   land on gold, since that reads `--roster-primary-500`.

Until those land, `UsernameForm`'s field stays a raw `<input>` pinned to `h-11`
so it matches `Button size="lg"` exactly. See the comment there.

### Quality

- [ ] Two `react-hooks/set-state-in-effect` errors, in `BirthChartPanel.tsx:60`
      and `Report.tsx:228`, plus an unused `PhenomenonKey` import in
      `app/api/og/route.tsx`. `npm run lint` has been failing on these; nothing
      runs it on the way in.
- [ ] Run `lint` + `typecheck` + `test` in CI so that cannot drift again.
