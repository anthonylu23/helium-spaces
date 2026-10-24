# helium-spaces step 3c: drag and keyboard check

Build: `build/src/out/Default/Helium.app` on branch `spaces/order`. Don't
rebuild, edit, commit or run git. Write evidence and the report outside the
repo (e.g. `~/Desktop/spaces-drag/`). Use a fresh temporary profile, launched
with `--enable-features=HeliumSpaces --user-data-dir=<tmp>`, and set up the
fixture through `chrome://spaces-internals` and `chrome.send()` over CDP, as
in the earlier checks (`devutils/spaces_screenshots.mjs` builds the same
fixture). The page's JSON gives each tab's index, space, group, pinned state,
and each window's `order_ok` and `order_fixes`. Every check below also needs
`order_ok: true` and `order_fixes` unchanged afterwards.

Fixture: Default has favorites F1 and F2, D1 and the internals tab. Work has
W1, then W2 and W3 in a group, then W4. Play has a pinned P1, then P2 and P3 in
a group. Order: F1 F2 | P1* | I D1 | W1 W2 W3 W4 | P2 P3 (Play's group is
right after Work's tabs).

Run each drag in Classic and in Vertical; then spot-check Compact and Dynamic
with items 1, 2 and 5.

1. In Work, drag W1 to the far left of the unpinned tabs and drop. Expected:
   it stays first among Work's tabs; no tab of another space appears.
2. In Work, drag W4 to the far right and drop. Expected: it is last; it does
   not join Play's group (W4 stays ungrouped and in Work).
3. In Work, drag W4 slowly rightward across the end of the strip, holding
   still near the end for a second, then drop. Expected: no group header or
   tab of Play appears, and W4 never disappears.
4. In Work, drag the W2/W3 group header to each end. Expected: the group stays
   inside Work's tabs.
5. In Work, drag W1 into the W2/W3 group and out again. Expected: normal group
   join and leave behavior.
6. In Work, pin W1, then drag it left over F1 and F2. Expected: it stays after
   the favorites. Drag F2 right past W1: it stays among the favorites.
7. Select W1 and W4 (Cmd-click), drag both to the far left. Expected: both
   stay in Work, together.
8. Open a second window and switch it to Play. Drag W4 from window 1 into
   window 2's strip and drop. Expected: W4 is shown in window 2 where it was
   dropped and now belongs to Play (`space` in the JSON). Window 1 stays in
   Work.
9. Drag F1 from window 1 into window 2. Expected: it stays a favorite (pinned,
   default space) and shows in every space of window 2.
10. Drag W1 out of window 1 onto the desktop. Expected: a new window opens
    with W1, in Work. Drag it back into window 1 (still showing Work): it
    rejoins Work.
11. Drag the W2/W3 group header into window 2 (showing Play). Expected: both
    tabs join Play.
12. Regression for a fixed crash: in window 1 (Work, with Default's D1
    before Work's tabs), drag W4 out onto the desktop, then back into window
    1's strip, and drop. Expected: no crash; W4 is in Work, among Work's tabs.
    Repeat dragging a favorite into window 2 after window 2 has a pinned tab
    of its shown space.
13. Pin W1 in window 1 (Work). Drag it over window 2 while window 2 shows
    the Default space, hold a moment, then press Escape. Expected: W1 is back
    in window 1, still a pinned tab of Work, not a favorite. Then drag it over
    window 2 and back to window 1 and drop there: same result.
14. With a favorite active, right-click a Work tab (in a window showing Work)
    and pick "New split view with current tab", and the reverse (Work tab
    active, menu on a favorite). Expected: both tabs of the split are in one
    space and the active tab stays visible. Then "Swap with active split" on
    another tab of the space.
15. Keyboard, if focus can be put on a tab (macOS Full Keyboard Access, or
    the F6 / Ctrl+F6 paths tried before): with W1 focused, Ctrl+Left/Right
    or the tab move shortcuts at the edges of Work's tabs. Expected: the tab
    stops at the edge and never joins Play's group. Also note whether keyboard
    focus can ever land on a hidden tab (open item from step 3b).
16. From the earlier spike, still open: drag a tab within a focused tab group,
    and onto another window, with tab group focus mode on, in Classic and
    Vertical, and judge whether drag animations look smooth.

Report: a grid of item × layout with P/F/U, a short reproduction for every F
(starting state, action, expected, seen, screenshot or recording), and the
JSON before and after for any F. Note anything else odd you see while
dragging, such as a tab flickering, a gap, or a hidden tab shown even briefly.
