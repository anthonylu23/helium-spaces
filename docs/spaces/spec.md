# helium-spaces spec

Condensed from the planning doc. When this and the planning doc disagree, this
file wins; update it as decisions change.

## Goal

Arc-style Spaces in one Helium window, optional per-space login isolation, and
tab organization features, carried as our own patch layer on top of Helium's.

Non-goals for now: syncing spaces across devices, Windows/Linux parity,
upstreaming to Helium, any change to Helium's privacy or ad-blocking behavior.

## Feature 1: Spaces

A Space is a named, colored set of tabs inside one window. **All spaces share
one TabStripModel.** A space is a filter over the window's tabs, not a second
model, so session restore, drag and drop, and tab commands keep working.

| Field | Type | Notes |
| --- | --- | --- |
| id | UUID | Stable across restarts; tabs reference it |
| name | string | User-editable |
| color | TabGroupColorId | Reuses the tab group palette |
| icon | emoji or symbol name | Shown in the switcher |
| isolation | `none`, `partition`, or `profile` | `none` = default cookie jar. `partition` is Feature 2; `profile` is the stretch goal |
| partition | string or empty | Only for `isolation: partition` |
| order | int | Position in the switcher |
| last_active | time | For restore and archive timers |

- Each tab stores its space id in session extra data, so Chromium's own restore
  puts it back. Tab extra data is not rewritten when Chromium compacts the
  session file, so we also hook the rewrite and tab restore paths. A tab's
  space is assigned once it is in a window. Each profile
  has one permanent default space with a fixed id; a tab with no space id
  belongs to it. Pinned with no space id = a favorite, shown in every space.
- Tab groups work inside a space, as in Arc. Spaces are not tab groups.
- Each space's tabs stay together in the underlying TabStripModel order. New
  tabs go at the end of the active space; dragging a tab across that boundary
  changes its space.
- Spaces must work in every Helium layout: Classic, Compact, Vertical, Dynamic.
  The sidebar is the main UI, but filtering and switching apply in all of them.
- Off for incognito and guest profiles.
- Built the way Chromium's tab group focusing mode is: wherever focus mode
  checks the focused group, we also check the active space. See
  `spikes/tab-group-focusing.md`.
- UI: switcher strip at the bottom of the vertical sidebar, sidebar filtered to
  the active space, sidebar tinted with the space color, "Move to space" in the
  tab menu, drag a tab onto a switcher icon.
- Switching: two-finger horizontal swipe over the sidebar only (page swipes
  keep back/forward), Cmd+Opt+Left/Right, Ctrl+Opt+1..9, click an icon. Ctrl+Tab
  stays inside the active space.
- Persistence: space list in a profile dictionary pref. The active space
  follows the active tab: activating a tab in another space switches to it,
  and while a favorite is active the window shows the space of its most
  recently active other tab. Tabs' last-active times are already saved, so
  the active space needs no session data of its own. Spaces are never
  auto-deleted.
- New tabs join the active space; restored tabs keep their own. Closing a
  space's last tab opens a new tab in it, as in Arc.

## Feature 2: Per-space isolation

Uses a StoragePartition per space, not a second Profile. Isolated per space:
cookies, cache, localStorage/IndexedDB/Cache API, service workers. Shared:
bookmarks, history, passwords, extensions, settings.

- A new tab in an isolated space gets a SiteInstance bound to that space's
  partition. Moving a tab across partitions reloads it there.
- Extension behavior in non-default partitions is unverified. A spike (Phase 5)
  must answer: do uBlock filters apply, do content scripts inject, which jar
  does `chrome.cookies` see, does password fill work, do downloads/PiP/DevTools
  work. Fallback: ship isolation as an advanced setting with a warning.
- True profile-per-space is a stretch goal, out of scope until partitions ship,
  but a wanted future feature. A Browser has exactly one Profile, so it likely
  means swapping windows on switch. Keep it open: isolation is an enum, space
  ids are globally unique, and the switcher reads spaces through an interface
  rather than straight from the window's profile.

## Feature 3: Tab organization

- Sidebar per space: favorites grid, space-pinned tabs, folders and groups,
  open tabs, an "Archived" link.
- Auto-archive: tabs inactive for 12h (configurable: off/12h/24h/7d) close into
  a per-space archive list. Exempt: pinned, favorites, audible, unsaved forms.
- Folders: sidebar-only, nestable, stored as a folder id on the tab.
- Tab Search gets a space column, a filter per space, and "move to space".
- Split view: already default in Chromium; just confirm pairs stay in a space.

## Architecture

New classes under `chrome/browser/ui/spaces/` and `chrome/browser/ui/views/spaces/`:

| Class | Role |
| --- | --- |
| SpaceRegistry (KeyedService) | Space list per profile, persisted to prefs |
| SpaceTabHelper (per WebContents) | Space and folder id on each tab |
| SpaceController (per Browser) | Active space per window, switching rules |
| SpacePartitionManager | Space id to StoragePartitionConfig and SiteInstance |
| TabArchiveService (KeyedService) | Archive timer and per-space archive list |
| SpaceSwitcherView, SpaceSettingsBubble | Switcher strip and settings popover |
| SpaceSwipeHandler | Turns sidebar horizontal scroll into space switches |

Existing Chromium files only get thin hooks; see `chromium-map.md`.

## Phases

| # | Phase | Exit criteria |
| --- | --- | --- |
| 1 | Build stock Helium | Our binary runs; a trivial patch applies, builds, validates |
| 2 | Scaffolding | Patch block, feature flag, docs, rebase log, dev env script |
| 3 | Spaces v1 | 3 spaces x 10 tabs survive restart in the right spaces. **Gate 1:** does the sidebar filter hold up? |
| 4 | Swipe and polish | Page back/forward swipe unaffected; switching feels native |
| 5 | Isolation spike | Written result per checklist item. **Gate 2:** ship, ship behind warning, or drop |
| 6 | Isolation v1 | Same site, two accounts, two spaces; uBlock still filters |
| 7 | Tab organization | Favorites, archive, folders, Tab Search column, each with a smoke checklist |
| 8 | Rebase and public build | Notarized DMG under our own name. **Gate 3:** rebase under two days? |
