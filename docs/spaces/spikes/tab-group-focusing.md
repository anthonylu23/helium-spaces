# Spike: Chromium tab group focusing

Phase 3, step 0. Started 2026-10-22 on Chromium 156.0.8078.47.

**Question:** Chromium ships an experimental "tab group focusing" mode that
hides every tab outside one group. Should Spaces build on it, and where do our
hooks go so Spaces work in every Helium layout mode?

**Decision so far:** option C. Spaces get their own space id per tab and reuse
focus mode's plumbing: each place that checks the focused group also checks the
active space. Option A (a space is a tab group with focus mode always on) is
ruled out because tabs inside a space must still be groupable, and groups can't
nest. The hands-on half below is still open.

## Code findings

### Focus mode, in the model and commands

| What | Where |
| --- | --- |
| Focused group lives in the selection state, next to the active tab | `chrome/browser/ui/tabs/tab_strip_model_selection_state.h:41` |
| Enter, exit, rotate | `TabStripModel::EnterFocusMode`, `ExitFocusMode`, `RotateFocusedGroup` (`tab_strip_model.h:731`) |
| Pinned tabs stay valid in every focused group | `TabStripModelSelectionState::IsTabValidInFocusedGroup` |
| Which tab activates after a close, Ctrl+Tab | `tab_strip_model.cc:3972`, `:4010` |
| Cmd+1..9 | `browser_commands.cc:608` |
| Moving a focused group to another window keeps focus | `browser_commands.cc:439` |
| Saved per window as window extra data, rewritten when the session file is | `session_service_base.cc:763`, read in `session_restore.cc:1360` |
| `NonGroupFocus`: an ephemeral, headerless group that only backs focus mode | `IsEphemeralTabGroup`, `PromoteEphemeralTabGroup` |

Focus mode exits on its own on many operations: closing or ungrouping the
focused group, dragging a group header in, pinning. Spaces must never do that;
there is always an active space. So we copy where focus mode hooks in, not how
it decides to exit.

### Layout modes

Helium has four layouts (`HeliumLayoutType`): Classic, Compact, Vertical,
Dynamic. Classic, Compact and Dynamic all use the horizontal tab strip region.
There are three view stacks, and focus mode already hides tabs in all three:

| Stack | Used by | Hide logic |
| --- | --- | --- |
| Collection views (`views/tabs/common/`) | Vertical | `UnpinnedTabContainerViewLayout::IsChildVisibleInContainer` (`:379`), `PinnedTabContainerView` (`:351`) |
| Legacy `TabStrip` + `TabContainerImpl` | Classic, Compact, Dynamic (default) | `TabContainerImpl::SetTabSlotVisibility` (`tab_container_impl.cc:735`), plus `TabStrip` keyboard moves (`tab_strip.cc:1786`) |
| Collection views via `HorizontalTabStripRegionViewNew` | Horizontal, only with `tabs::kTabStripUnification` (off by default) | Same as Vertical |

Spaces therefore need a view-level hook in two places: the shared collection
layouts and the legacy `TabContainerImpl`. When Google flips
`kTabStripUnification` on and removes the legacy strip, the second hook goes
away. Model and command hooks are shared by every mode.

### Testing

`browser_tests`, `unit_tests` and even `base_unittests` cannot build in this
tree. The imputnet `-base` tarball ships without test data
(`chrome/test/data/` has 5 of its folders, `base/test/data/` is missing), so
`siso ninja -n` fails on missing inputs. Getting them back means a full git
checkout (`he setup -c`), which is far beyond our disk and time budget.

Plan instead:

1. Keep pure logic (space list parsing, ordering, the contiguity rule, extra
   data encoding) in classes with no `Browser` or `Profile` dependency, and
   test them with our own small gtest target, `spaces_unittests`, built from
   `//testing/gtest` and `//base/test:run_all_unittests` with no test-data
   deps. Not yet proven to build.
2. Test restart and session-file rewrites end to end with the CDP smoke test,
   reading state from a minimal `chrome://spaces-internals` page.

### Profile per space (future)

A `Browser` belongs to exactly one `Profile`, so every tab in a
`TabStripModel` shares one profile. Profile per space in one window therefore
means swapping which `Browser` is shown when you switch to a space in another
profile, or a much larger change to Chromium. Not solving that now, but these
choices keep it open:

- Space isolation is an enum, `none | partition | profile`, not just a
  partition string.
- Space ids are UUIDs, unique across profiles, so a space can later move
  between profiles or be listed in a browser-wide index.
- The switcher and `SpaceController` get the space list through an interface,
  not straight from the window's profile, so it can later list spaces from
  several profiles.
- Per-window state stores the active space id only; nothing assumes the
  active space's tabs live in this window's `TabStripModel`.

## Hands-on checklist (open)

Launch with a throwaway profile so the dev profile stays clean:

```bash
build/src/out/Default/Helium.app/Contents/MacOS/Helium \
  --user-data-dir="$(mktemp -d)" --use-mock-keychain --no-first-run \
  --enable-features=TabGroupsFocusing,TabGroupRibbon,NonGroupFocus
```

Make 3 groups of about 5 tabs, plus 2 pinned tabs and a few ungrouped tabs.
Then, in Vertical and in Classic:

- [ ] Focus a group (group context menu, or the ribbon). Do the other tabs
      hide cleanly, with no gaps, flicker or wrong scroll position?
- [ ] Switch focus between groups. Does it feel fast enough to build space
      switching on?
- [ ] Ctrl+Tab, Cmd+1..9, close the last tab in the focused group. What
      activates?
- [ ] Drag a tab within the focused group, and onto another window.
- [ ] New tab (Cmd+T) while focused. Where does it land?
- [ ] Quit and relaunch with the same `--user-data-dir`. Is focus restored?
- [ ] Anything that crashes or looks broken. That code is what we would hook.

Optional: add `TabStripUnification` to `--enable-features` and repeat in
Classic to see the newer horizontal views.

## Result

To fill in after the hands-on pass.
