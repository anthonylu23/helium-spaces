# helium-spaces step 4: switcher, shortcuts and tab menu check

Build: `build/src/out/Default/Helium.app` on branch `spaces/switcher`. Don't
rebuild, edit, commit or run git. Write evidence and the report outside the
repo (e.g. `~/Desktop/spaces-switcher/`). Use a fresh temporary profile,
launched with `--enable-features=HeliumSpaces --user-data-dir=<tmp>`, and set
up the fixture through `chrome://spaces-internals` and `chrome.send()` over
CDP, as in the earlier checks (`devutils/spaces_screenshots.mjs` builds the
same fixture). The page's JSON gives each tab's space, and each window's
`active_space_id`, `order_ok` and `order_fixes`; every item also needs
`order_ok: true` and `order_fixes` unchanged afterwards.

Fixture: Default has the favorite F1, D1 and the internals tab. Work has W1,
then W2 and W3 in a group. Play has P1 and P2. The spaces are, in order,
Default, Work, Play.

The switcher is a row of space icons at the bottom of the vertical tab strip
(Vertical layout only): a dot in the space's color, or its emoji, with "+" at
the right end. The active space's icon sits on a tint of its color.

1. Vertical, sidebar expanded: the row shows three dots and "+". Hovering a
   dot shows the space's name. Clicking each dot switches to that space (the
   tab strip shows only its tabs and F1); the active dot follows. Screenshot
   each.
2. Click "+". Expected: a space named "Space 4" is added and shown with a New
   Tab page, and an "Edit space" bubble opens at its icon with Name, Emoji and
   a row of colors. Type a name and an emoji (e.g. 🎮), pick another color,
   click Done: the icon shows the emoji and the JSON has the new name, icon
   and color. Open it again and press Cancel: nothing changes.
3. Right-click Work's icon: "Edit Space...", "Delete Space". On Default's
   icon "Delete Space" is disabled. Delete Space 4: its icon goes, and its New
   Tab page moves to Default.
4. Add spaces until there are about 12, then make the sidebar as narrow as it
   goes while expanded. Expected: the icons shrink to small dots and all stay
   clickable; "+" stays at the right. Screenshot.
5. Collapse the sidebar (its collapse button, or the shortcut). Expected: only
   the active space's icon shows. Clicking it opens a menu of all spaces, the
   active one checked, then "New Space"; picking one switches. With
   expand-on-hover on, the sidebar stays expanded while that menu is open.
6. Shortcuts, in Classic and Vertical, spot-checking Compact and Dynamic:
   Cmd+Opt+Right and Cmd+Opt+Left switch to the next and previous space and
   wrap around at the ends; Ctrl+1, Ctrl+2 and Ctrl+3 select Default, Work and
   Play; Ctrl+9 does nothing with three spaces. Cmd+Shift+] / [ and Ctrl+Tab
   still switch tabs inside the space. In an incognito window (Cmd+Shift+N),
   which has no spaces, Cmd+Opt+Left/Right switch tabs. Note if macOS takes Ctrl+number (Mission
   Control's "Switch to Desktop N") on this machine.
7. Tab context menu, in Classic and Vertical:
   - On W1: "Move to Space" lists Default and Play (dots in their colors, or
     emoji). Pick Play: W1 leaves the strip, the window stays in Work, and the
     JSON has W1 in Play.
   - On a Work tab: "Pin" and "Add to Favorites". On D1 (switch to Default):
     the pin item reads "Add to Favorites", and there is no separate one. On
     F1: "Remove from Favorites".
   - "Add to Favorites" on the active Work tab: it becomes a favorite, stays
     active, and the window stays in Work. "Remove from Favorites" on it: it
     goes back to Work's tabs.
   - "Add Tab to Group" lists only the shown space's groups: in Work, the
     W2/W3 group; never one of Play's.
8. Drag onto icons, Vertical:
   - Drag W1 down onto Play's icon. While over it, the icon is highlighted
     more strongly. Drop: W1 moves to Play, the window stays in Work, and no
     new window is torn off.
   - Drag the W2/W3 group header onto Play's icon: both tabs move to Play,
     still grouped.
   - Drag a tab over the "+" or the space between icons and drop: it behaves
     as before (it tears off into a new window, as anywhere outside the strip).
   - With a second window open, drag a tab from it onto window 1's Play icon:
     it lands in window 1, in Play.
   - Start a drag and press Escape over an icon: nothing moves.
9. Hover card, in Classic and Vertical: hover a tab until its card shows,
   then press Cmd+Opt+Right. Expected: the card disappears at once, with no
   fade over the new space.
10. Helium's keyboard shortcuts settings page lists "Next space", "Previous
    space" and "Space 1" to "Space 9" with their keys.
11. Flag off (`--disable-features=HeliumSpaces`, fresh profile): no switcher,
    no Spaces items in the tab menu, and Cmd+Opt+Left/Right switch tabs.
12. From the step 3c check, still open: with macOS Full Keyboard Access on,
    whether keyboard focus can be put on a tab, and if so whether
    Ctrl+Left/Right or the tab move shortcuts stop at the edges of Work's tabs.

Report: a grid of item x layout with P/F/U, a short reproduction for every F
(starting state, action, expected, seen, screenshot or recording), and the
JSON before and after for any F. Note anything else odd: icons clipped or
misaligned, a flicker when switching, the bubble placed off-screen, a menu
that doesn't close.
