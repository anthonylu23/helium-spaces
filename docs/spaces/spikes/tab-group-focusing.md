# Spike: Chromium tab group focusing

Phase 3, step 0. Started 2026-10-22 on Chromium 156.0.8078.47.

**Question:** Chromium ships an experimental "tab group focusing" mode that
hides every tab outside one group. Should Spaces build on it, and where do our
hooks go so Spaces work in every Helium layout mode?

**Decision so far:** option C. Spaces get their own space id per tab and reuse
focus mode's plumbing: each place that checks the focused group also checks the
active space. Option A (a space is a tab group with focus mode always on) is
ruled out because tabs inside a space must still be groupable, and groups can't
nest. The computer-use pass below supports reusing the plumbing; actual dragging
and a human assessment of animation smoothness remain open.

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

## Hands-on checklist (2026-10-22 pass; dragging open)

Launch with a throwaway profile so the dev profile stays clean:

```bash
build/src/out/Default/Helium.app/Contents/MacOS/Helium \
  --user-data-dir="$(mktemp -d)" --use-mock-keychain --no-first-run \
  --enable-features=TabGroupsFocusing,TabGroupRibbon,NonGroupFocus
```

Make 3 groups of about 5 tabs, plus 2 pinned tabs and a few ungrouped tabs.
Then, in Vertical and in Classic:

- [x] Focus a group through its context menu. Other tabs hide without gaps
      in the captured layouts; see the animation and scrolling limits below.
- [x] Switch focus between groups and verify the resulting visible tabs.
- [ ] Assess perceived switching speed, brief flicker and deep scroll-position
      behavior by hand.
- [x] Ctrl+Tab, Cmd+1..9, close the last tab in the focused group. What
      activates?
- [ ] Drag a tab within the focused group, and onto another window.
- [x] New tab (Cmd+T) while focused. Where does it land?
- [x] Quit and relaunch with the same `--user-data-dir`. Is focus restored?
- [x] Anything that crashes or looks broken. That code is what we would hook.

Optional: add `TabStripUnification` to `--enable-features` and repeat in
Classic to see the newer horizontal views.

## Result

Computer-use pass on 2026-10-22, using the existing local component build
(Helium 0.20.1.1, Chromium 156.0.8078.47). Launched with the command above,
verified the executable, command line and throwaway profile in `chrome://version`,
and created A/B/C groups of five labeled local data-URL tabs each, two pinned
tabs (P1/P2), and three ungrouped tabs (U1/U2/U3). Used the same profile in
Classic and Vertical. No source or patch changes were needed for this pass.

| Check | Classic and Vertical observations |
| --- | --- |
| Enter focus | Group context menu works. Only the focused group's tabs and P1/P2 remain in the strip. Captured layouts have no holes left by hidden tabs. |
| Switch groups | Ctrl+Cmd+X/Z rotates forward/backward, including wraparound. The next captured state has the expected group and active tab. No reproducible stuck strip or wrong group was observed. |
| Ctrl+Tab | Moves within the focused group and pinned tabs. From the group's final tab it wraps to P1; hidden groups and U1/U2/U3 are skipped. |
| Cmd+1..9 | P1/P2 occupy positions 1/2; positions 3..7 select the five focused tabs. Cmd+8 is a no-op with seven visible tabs; Cmd+9 selects the last focused tab. |
| Cmd+T | Joins the focused group at its end with the default “Open new tabs next to the active tab” setting off. Also joins that group when a pinned tab is active. |
| Close final group tab | Saved groups first show “Close Tab and Delete Group?”. After the human authorized deletion of the disposable fixture groups, confirming it exits focus, reveals the remaining tabs, and activates P2 in both layouts. Spaces must supply their own empty-space behavior. |
| Move to another window via menu | Works in both layouts. The destination receives an ungrouped tab; the source activates another tab in the group and stays focused. This exercises transfer behavior, not pointer dragging. |
| Restart | `chrome://restart` preserves focus in both layouts. A separate full quit (holding Cmd+Q), verified browser-process exit, and relaunch with the same arguments also preserves group C focus: C5 in Classic, C3 in Vertical. “Continue where you left off” was enabled for these tests. The restored fixture window was selected through Window; a foreground blank window alone does not establish restore failure. |

**Decision:** proceed with option C for model, command and visibility plumbing.
The tested state transitions support building space switching on these hooks.
No reproducible application crash or persistent layout break was established.
The confirmation and focus exit when the last group tab closes are expected
group semantics, and must not become Spaces semantics.

**Limits and remaining work:** this was sampled UI automation, not a frame-time
measurement or a human animation review. It supports correct, prompt state
changes at this fixture size; it cannot certify the absence of brief flicker or
judge perceived smoothness. The focused lists fit without scrolling, so deep
scroll-position behavior is also untested. Pointer-drag attempts in both layouts
produced no observable reorder, so actual within-group dragging and dropping
onto another window remain unchecked; do not count the successful menu moves
as a drag pass. Repeat those two actions by hand before closing the spike.
The optional unified horizontal tab strip was not tested.
