# Status

**Current phase: 3 (Spaces v1). Steps 1 and 2 committed on branch
`spaces/registry`. Step 3a (`SpaceController`, model and command hooks)
pushed on branch `spaces/controller`. Step 3b (hiding tabs in the tab
strip views) visually checked in all four layouts and pushed there too; next
is 3c. Step 0 spike: code review and
computer-use checks support option C; actual dragging and human animation
review remain open.**

Last updated 2026-10-23. Deferred work and deliberate decisions are in
`deferred.md`.

## Baseline

| Item | Value |
| --- | --- |
| Helium | 0.20.1.1 (core `f29a2596`, macOS `9aa975a`) |
| Chromium | 156.0.8078.47 |
| Machine | M3 Pro, 11 cores, 18 GB RAM, Xcode 26.2 (upstream CI uses 26.5) |
| Our patches | 7, in `patches/spaces/` |

## Measured build costs

| Step | Time | Notes |
| --- | --- | --- |
| `he setup` | ~5 min | 1.3 GB Chromium tarball download, unpack, prune, 369 Helium patches, gn gen |
| First full `he build` | 4 h 12 min | Compile time across two runs; component build, cold ccache |
| Incremental build after the flag patch | 33 s | New source set plus `about_flags.cc` |
| Disk | 26 GB | `build/` total: 13 GB source, 10 GB output, 3.3 GB download cache |

## Done

### Phase 1: Build stock Helium

- [x] Forks: `anthonylu23/helium-spaces` (from helium-macos) and
      `anthonylu23/helium-spaces-core` (from helium, the `helium-chromium`
      submodule). Upstream remotes are fetch-only.
- [x] Prerequisites installed, including Metal toolchain and a 30 GB ccache.
- [x] Full component build runs: `Helium 0.20.1.1 (Chromium 156.0.8078.47)`.
- [x] Build fix: a `node_modules` in `$HOME` broke TypeScript dependency
      checks. Fixed by `spaces/tooling/ts-ignore-out-of-tree-definitions.patch`.

### Phase 2: Scaffolding

- [x] `# helium-spaces` block at the end of `patches/series`; patches in
      `patches/spaces/`. Decided: our patches live in this repo, not core.
- [x] `spaces/core/add-spaces-feature-flag.patch`: `spaces::features::kHeliumSpaces`
      in `chrome/browser/ui/spaces/`, flag `chrome://flags/#helium-spaces`,
      off by default. Proves the quilt, build, and validation loop end to end.
- [x] `spaces-dev.sh` dev environment wrapper.
- [x] `devutils/spaces_smoke.mjs` headless smoke test: 4 of 4 checks pass.
- [x] `AGENTS.md`, `CLAUDE.md`, README, and `docs/spaces/` (spec, development,
      chromium map, rebase log, this file). Core fork's `AGENTS.md` replaced.
- [x] `he validate series` and `he validate config` pass.

## Next steps

1. Done: scaffolding pushed and fast-forwarded into `main` in both repos
   (core `d433c10b`, macOS `6fe5a2b`).
2. Phase 3, Spaces v1, in this order, one patch each:
    0. Spike: tab group focusing. Computer-use results for Classic and Vertical
       are recorded in `spikes/tab-group-focusing.md`. Finish actual dragging
       within a focused group and onto another window, and assess animation
       smoothness by hand. Deep scroll-position behavior is untested.
    1. Done: `spaces/core/add-space-registry.patch`.
       `SpaceRegistry` keyed service and `helium_spaces.spaces` list pref, no
       UI. GN split: `:model` (pure logic, unit tested), `:spaces` (service,
       modularized deps only), `spaces_unittests`.
    2. Done: `spaces/core/add-space-tab-helper.patch` and
       `spaces/tooling/add-spaces-internals.patch`. Space id per tab, written
       when it changes and in `BuildCommandsForTab()` (session-file rewrites
       and restored tabs), and through reopen-closed-tab. Each hook has a
       smoke check that fails without it (verified by removing each one).
       A `TabInserted()` hook turned out to be unnecessary and was dropped:
       step 3 must assign a tab's space after it is in a window.
       Active space per window moved to step 3, with `SpaceController`.
    3. a. Done: `spaces/core/add-space-controller.patch`.
          `SpaceController` per normal window, owned by Chromium's
          `EmbedderBrowserWindowFeatures`, and a `TabSpaceFilter` set on the
          `TabStripModel`. The active space follows the active tab; with a
          favorite active it is the space of the most recently active other
          tab, so it needs no session data of its own. New tabs join the
          active space. Closing a space's last tab opens a new tab there.
          Ctrl+Tab (and Helium's MRU cycling), Cmd+1..9, the tab activated
          after a close, collapsing a group, and close-other/close-to-the-side
          tabs stay in the active space. Mutation-tested like step 2. A
          review workflow (3 reviewers, adversarial verify) found 7 real
          issues, all fixed: unpinning the active favorite, returning to a
          background tab instead of the last active one, briefly showing
          another space's tab when closing a space's last tab (now a new tab
          opens before the close), group collapse and collapsed-group close
          fallbacks, close-tabs-to-the-left on an out-of-space tab, and a
          smoke check that could not fail. The last three have no smoke
          check: the internals page can't drive groups or the tab menu.
       b. Done:
          `spaces/ui/hide-tabs-outside-active-space.patch`. Tabs outside the
          active space, their group headers, and pinned tabs of other spaces
          are hidden next to the focus-mode checks: `TabStripLayoutHelper`
          and `TabContainerImpl` (Classic, Compact, Dynamic), and the
          collection containers (Vertical). Both stacks relayout through
          `TabSpaceFilter::RegisterTabVisibilityChanged()`. A tab moved to
          another space leaves its group, so groups stay in one space.
          `devutils/spaces_screenshots.mjs` exercises every layout and space
          in a real window and screenshots them, given Screen Recording
          permission. Codex's visual check and recheck (2026-10-23) passed in
          all four layouts: settled and immediate switches (no other-space
          tabs, slivers or headers once the horizontal strip snapped instead
          of animating), layout changes, resizing, Cmd+T/W, Ctrl+Tab,
          Cmd+1..9, favorites, groups, pinning, and quit and restore seen on
          screen. Dynamic's new-tab button sits in the toolbar by Helium's
          design. Open: a hover card already showing for a tab fades out over
          the new space instead of vanishing, and keyboard focus on hidden
          tabs is untested; both are in `deferred.md`.
       c. Range selection, keyboard tab moves, drag targets and the
          contiguity rule.
    4. Switcher strip, keyboard switching, tab context menu.
3. Consider Xcode 26.5 to match upstream CI before the first rebase.

## Smoke checklist

Automated (`devutils/spaces_smoke.mjs`):

- Browser starts headless and reports a version.
- `chrome://flags/#helium-spaces` exists, is named "Helium Spaces", is off by default.
- Flag off: no spaces are saved. Flag on: one default space, same id after a restart.
- Tabs assigned to spaces keep them after a restart, a second restart, a
  forced session-file rewrite, and close plus reopen (Cmd+Shift+T).
- Switching (to an empty space, back to a space's most recent tab), new tabs
  joining the active space, Ctrl+Tab, Cmd+1/Cmd+9, favorites, "Close other
  tabs", closing a space's last tab, activating a tab elsewhere, removing the
  active space, and the active space after a restart with a favorite active.

Unit (`spaces_unittests`): 12 `SpaceList` tests.

Manual, until automated:

- `he run` opens a window with vertical tabs available.
