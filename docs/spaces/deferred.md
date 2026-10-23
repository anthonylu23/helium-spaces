# Deferred work and decisions

Things we chose not to do yet, or decided on purpose, so they aren't
rediscovered as bugs. Add a row when you defer something; remove it when it's
done or no longer applies. `status.md` tracks what's in progress.

## Deferred

| Item | Why deferred | Revisit | Found |
| --- | --- | --- | --- |
| A hover card already showing for a tab fades out over the new space when switching away, instead of vanishing | `TabHoverCardController::HideHoverCard()` always fades unless animations are off; skipping it needs a new hook in Chromium's hover card controller. Cosmetic, about one fade's length, and the same as when a hovered tab closes | Phase 3 step 4 or the phase 4 polish pass | Codex recheck of step 3b, 2026-10-23 |
| Keyboard focus on hidden tabs is untested | Codex could not move keyboard focus into the tab strip at all, even for visible tabs. Hidden tabs are `SetVisible(false)`, which views focus traversal skips, so no problem is expected | Any later visual pass; try with macOS Full Keyboard Access on | Step 3b visual check |
| Each space's tabs are not yet kept together in the TabStripModel order | Only visible once range selection, keyboard tab moves or drag cross hidden tabs, so it belongs with them | Step 3c | Step 3a plan |
| Shift-click range selection, Ctrl+Shift+PgUp/PgDn tab moves, and drag targets can cross hidden tabs | Same as above | Step 3c | Explorer map for step 3b |
| `WillCloseTabs()` opens the replacement tab before the close runs; if a beforeunload dialog then cancels the close, the new tab stays | Rare, and harmless (an extra New Tab page in the space). Fixing it means hooking the unload-cancel path | When close behavior gets its next change | Step 3a review fixes |
| No smoke check for: the group-collapse and collapsed-group close fallbacks, "Close tabs to the left" on an out-of-space tab, and whether "Close other tabs" is enabled in the menu | The internals page couldn't make groups (it can now: `groupTabs`) or open the tab menu | Step 3c, or when the tab menu gets Spaces items (step 4) | Step 3a review |
| Dragging within a focused group and onto another window, and animation smoothness by hand | From the focus-mode spike; pointer drags didn't register under computer use | Step 3c, with drag | `spikes/tab-group-focusing.md` |
| `gn check` fails in some hooked targets on one include each that isn't ours (favicon, autofill_ml_internals, accessibility, Helium's `horizontal_tab_style_views.cc`) | Pre-existing in Chromium or Helium; our own targets are clean | Upstream sync | Steps 2 and 3b |

## Decisions

| Decision | Why | Where |
| --- | --- | --- |
| A pinned tab in the default space is a favorite, shown in every space. Pinning a tab in another space makes it space-pinned. So the default space has no space-pinned tabs, and removing a space turns its pinned tabs into favorites | Matches the spec's "pinned with no space id = a favorite"; the review flagged both consequences and the verifier upheld them | `SpaceController::IsFavorite()`, `spec.md` |
| Duplicating a favorite makes a space-pinned tab of the active space | Duplicates are new tabs, and new tabs join the active space | `SpaceController::OnTabStripModelChanged()` |
| New tabs always join the active space, never their opener's | Simpler, and an opener in another space is rare (only a hidden tab opening a window) | `SpaceController::OnTabStripModelChanged()` |
| The active space is not saved; it follows the active tab, or, with a favorite active after a restart, the most recently active other tab | Tabs' last-active times are already in the session, so no window extra data or session restore hooks are needed. A tab opened in the background after the last-active one can win after a restart, which is nearly always the same space | `SpaceController::GetSpaceForActiveTab()` |
| Closing a space's last tab opens a New Tab page there, rather than moving to another space | Arc keeps you in the space; focus mode exits instead, which is the behavior we don't want | `SpaceController::WillCloseTabs()` |
| Switching spaces is instant in the horizontal strip, not animated | Animating, as focus mode does, shows the old space's tabs shrinking away | `BrowserTabStripController::InitFromModel()` hook |
| A tab moved to another space leaves its tab group | Groups stay within one space, so a group's visibility follows its first tab | `SpaceController::MoveTabToSpace()` |
| Dynamic's new-tab button is in the toolbar | Helium's design (`ShouldShowNewTabButton()`), not ours | Helium |
