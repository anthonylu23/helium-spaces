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
  belongs to it. Favorites belong to the profile, as in Arc, not to a space:
  a favorite is a pinned tab stored with a reserved favorites id instead of a
  space id, and shows in every space without separate logins (Feature 2).
  Every space, the default one too, has its own pinned tabs.
- Tab groups work inside a space, as in Arc. Spaces are not tab groups.
- Each space's tabs stay together in the underlying TabStripModel order:
  its pinned tabs in one run, its other tabs in another, with favorites before
  every space's pinned tabs. New tabs go at the end of the active space's tabs.
  Moves, extensions' included, stay inside the tab's space; changing space is
  explicit (the tab menu, or dropping a tab on a switcher icon).
- A tab dropped into another window joins the space that window shows, as in
  Arc. Favorites stay favorites. Arc's warning ("you could be logged out")
  would apply when the two spaces' logins differ; not built yet
  (`deferred.md`).
- Unpinning a favorite moves it to the active space, as in Arc. A tab added to
  a tab group joins the group's space.
- Spaces must work in every Helium layout: Classic, Compact, Vertical, Dynamic.
  The sidebar is the main UI, but filtering and switching apply in all of them.
- Off for incognito and guest profiles.
- Built the way Chromium's tab group focusing mode is: wherever focus mode
  checks the focused group, we also check the active space. See
  `spikes/tab-group-focusing.md`.
- UI: switcher strip at the bottom of the vertical sidebar, sidebar filtered to
  the active space, sidebar tinted with the space color, "Move to space" in the
  tab menu, drag a tab onto a switcher icon.
- Switching: two-finger horizontal swipe over the vertical sidebar only (page
  swipes keep back/forward; phase 4). No swipe in Classic, Compact or Dynamic,
  where it would be confused with scrolling the tab strip; they get a space
  button or menu instead (phase 4). Cmd+Opt+Left/Right (taken from tab switching
  while Spaces is on, as in Arc; wraps around), Ctrl+1..9 as in Arc, click an
  icon. Ctrl+Tab stays inside the active space.
- Switcher: one icon per space (its emoji, or a dot in its color) and "+",
  at the bottom of the vertical sidebar; right-click to edit or delete a
  space. Collapsed, only the active space's icon shows, and it opens a menu
  of spaces. Tab menu: "Move to Space", Pin and "Add to Favorites", "Remove
  from Favorites" on a favorite; "Add Tab to Group" lists only the shown
  space's groups.
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
  partition. Moving a tab across partitions reloads it there: any change of
  a tab's space, and turning a space's isolation on or off. Discarded,
  restored and reopened tabs stay in their partition, session cookies last
  across restarts, and the startup storage cleanup keeps every space's
  storage. Turning isolation off keeps the storage; removing the space
  deletes it.
- The setting is "Separate logins in this space" in the Edit space bubble,
  with a description of what doesn't work in such a space.
- Favorites live in the profile's default partition, so a space with
  separate logins doesn't show them, and offers Pin instead of "Add to
  Favorites" (the user, 2026-10-27). Its pinned tabs take their place until
  the favorites grid (Phase 7) can give such a space favorites of its own.
- Extension behavior in non-default partitions is unverified. A spike (Phase 5)
  must answer: do uBlock filters apply, do content scripts inject, which jar
  does `chrome.cookies` see, does password fill work, do downloads/PiP/DevTools
  work. Fallback: ship isolation as an advanced setting with a warning.
  Gate 2 (2026-10-25) chose the fallback: notifications, push and
  `chrome.cookies` don't work in an isolated space
  (`spikes/space-isolation.md`).
- True profile-per-space is a stretch goal, out of scope until partitions ship,
  but a wanted future feature, with its own spike after Phase 5. It doesn't
  replace partitions: a partition keeps history, passwords and extensions
  shared, a profile separates everything and makes notifications and
  extensions work. A Browser has exactly one Profile, so it likely
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

## Future: per-space colors and themes

Each space can have its own color and theme, as Arc does: switching spaces
changes the window's colors (sidebar, toolbar, frame), not only the switcher
icon. Builds on tinting the sidebar with the space's color (`deferred.md`).
Open questions: whether a space's theme is a full Chromium theme or a color
scheme generated from one seed color, and how it combines with the profile's
theme and with light and dark mode. Not scheduled yet; it would add a theme
field to the space alongside `color`.

## Architecture

New classes under `chrome/browser/ui/spaces/` and `chrome/browser/ui/views/spaces/`:

| Class | Role |
| --- | --- |
| SpaceRegistry (KeyedService) | Space list per profile, persisted to prefs |
| SpaceTabHelper (per WebContents) | Space and folder id on each tab |
| SpaceController (per Browser) | Active space per window, switching rules |
| space_partition.h, space_storage.h | Space id to StoragePartitionConfig and SiteInstance; a space's storage on disk |
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
