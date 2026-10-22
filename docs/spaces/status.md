# Status

**Current phase: 3 (Spaces v1), step 0: tab group focusing spike. Code half
done; hands-on half open. Scaffolding still pending review and first commit.**

Last updated 2026-10-22.

## Baseline

| Item | Value |
| --- | --- |
| Helium | 0.20.1.1 (core `f29a2596`, macOS `9aa975a`) |
| Chromium | 156.0.8078.47 |
| Machine | M3 Pro, 11 cores, 18 GB RAM, Xcode 26.2 (upstream CI uses 26.5) |
| Our patches | 2, in `patches/spaces/` |

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

1. Review and commit the scaffolding branch `spaces/scaffolding` in both repos,
   push core first, then merge into `main`.
2. Phase 3, Spaces v1, in this order, one patch each:
    0. Spike: tab group focusing. Finish the hands-on checklist in
       `spikes/tab-group-focusing.md` and write its result.
    1. `SpaceRegistry` keyed service and prefs (no UI). Settle the GN target
       split first; a keyed service depends on `//chrome/browser`.
    2. Space id per tab with session round-trip: initial write, the
       session-file rewrite (`BuildCommandsForTab`), and tab restore. Active
       space per window as window extra data. Plus `spaces_unittests` and a
       minimal `chrome://spaces-internals` for the smoke test.
    3. `SpaceController` and filtering, at the focus-mode hook points, in both
       the collection views (Vertical) and the legacy `TabContainerImpl`
       (Classic, Compact, Dynamic).
    4. Switcher strip, keyboard switching, tab context menu.
3. Consider Xcode 26.5 to match upstream CI before the first rebase.

## Smoke checklist

Automated (`devutils/spaces_smoke.mjs`):

- Browser starts headless and reports a version.
- `chrome://flags/#helium-spaces` exists, is named "Helium Spaces", is off by default.

Manual, until automated:

- `he run` opens a window with vertical tabs available.
