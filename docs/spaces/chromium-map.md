# Chromium map

Every existing Chromium or Helium file our patches touch, which patch touches
it, and the Chromium version it was last verified against. Refresh the
"Verified on" column after every upstream sync. "Planned" rows are from the
spec and have not been checked against the source yet.

New files we add (under `chrome/browser/ui/spaces/` and
`chrome/browser/ui/views/spaces/`) are not listed; they cannot conflict.

## Hooks in use

| File | Patch | Hook | Verified on |
| --- | --- | --- | --- |
| `chrome/browser/about_flags.cc` | `spaces/core/add-spaces-feature-flag.patch` | Include of `spaces_flag_entries.h` in `kFeatureEntries`, include of `spaces_features.h` | 156.0.8078.47 |
| `chrome/browser/BUILD.gn` | `spaces/core/add-spaces-feature-flag.patch` | Dep on `//chrome/browser/ui/spaces:features` in `source_set("core")`, desktop block | 156.0.8078.47 |
| `chrome/browser/profiles/BUILD.gn` | `spaces/core/add-space-registry.patch` | Dep on `//chrome/browser/ui/spaces` in `profiles_extra_parts_impl`, `!is_android` block | 156.0.8078.47 |
| `chrome/browser/profiles/chrome_browser_main_extra_parts_profiles.cc` | `spaces/core/add-space-registry.patch` | Include, and `SpaceRegistryFactory::GetInstance()` at the end of `EnsureBrowserContextKeyedServiceFactoriesBuilt()` | 156.0.8078.47 |
| `chrome/browser/sessions/BUILD.gn` | `spaces/core/add-space-tab-helper.patch` | Dep on `//chrome/browser/ui/spaces:tab_space` in `impl`, `enable_session_service` block | 156.0.8078.47 |
| `chrome/browser/sessions/session_service_base.cc` | `spaces/core/add-space-tab-helper.patch` | Include; `CreateSpaceIdSessionCommand()` in `BuildCommandsForTab()`, after the pinned state. Runs on session-file rewrites and for every restored tab | 156.0.8078.47 |
| `chrome/browser/ui/BUILD.gn` | `spaces/core/add-space-tab-helper.patch` | Dep on `:tab_space` in `browser_tabrestore_impl` and `browser_live_tab_context_impl` | 156.0.8078.47 |
| `chrome/browser/ui/browser_tabrestore.cc` | `spaces/core/add-space-tab-helper.patch` | Include; `RestoreSpaceIdFromExtraData()` next to glic and send-tab-to-self in `CreateRestoredTab()` | 156.0.8078.47 |
| `chrome/browser/ui/browser_commands.cc` | `spaces/core/add-space-controller.patch` | `IsTabSelectable()` also requires `IsTabInActiveSpace()`, so Cmd+1..9 stay in the active space | 156.0.8078.47 |
| `chrome/browser/ui/browser_window/internal/BUILD.gn` | `spaces/core/add-space-controller.patch` | Dep on `//chrome/browser/ui/spaces:controller` in `internal`, non-Android block | 156.0.8078.47 |
| `chrome/browser/ui/browser_window/internal/embedder_browser_window_features.cc` | `spaces/core/add-space-controller.patch` | Include; create `SpaceController` in `Init()`, reset it in `TearDownPreBrowserWindowDestruction()`. Chromium's slot for embedder window features | 156.0.8078.47 |
| `chrome/browser/ui/browser_window/public/embedder_browser_window_features.h` | `spaces/core/add-space-controller.patch` | Forward declaration and `space_controller_` member | 156.0.8078.47 |
| `chrome/browser/ui/tabs/BUILD.gn` | `spaces/core/add-space-controller.patch` | Dep on `//chrome/browser/ui/spaces:tab_space_filter` in `tab_strip_impl` | 156.0.8078.47 |
| `chrome/browser/ui/tabs/tab_strip_model.h` | `spaces/core/add-space-controller.patch` | Forward declaration; `SetSpaceFilter()`, `space_filter()`, `IsTabInActiveSpace()` after `RotateFocusedGroup()`; `space_filter_` member | 156.0.8078.47 |
| `chrome/browser/ui/tabs/tab_strip_model.cc` | `spaces/core/add-space-controller.patch` | Include; `IsTabInActiveSpace()` next to the focused-group checks in `GetIndicesClosedByCommand()`, `GetTabsClosedByCommand()`, `SelectRelativeTab()`, `DetermineNewSelectedIndex()` (plus a nearest-in-space fallback before its unfiltered one), the group overload of `GetNextExpandedActiveTab()`, and Helium's `SelectMRUTab()`. `TabSpaceFilter::WillCloseTabs()` in `CloseWebContents()` and `ExecuteCloseTabs()`, before the re-entrancy guard, next to ungoogled's `close-window-with-last-tab` | 156.0.8078.47 |
| `chrome/browser/ui/tabs/tab_strip_model.cc` | `spaces/core/keep-space-tabs-together.patch` | `TabSpaceFilter::WillInsertTabs()` after the pinned clamp in `InsertTabAtImpl()` and `InsertDetachedTabGroupAt()`, and in `InsertDetachedSplitTabAt()`; `ConstrainMoveIndex()` after the pinned clamp in both `MoveWebContentsAt()`s, `MoveGroupTo()` and `MoveSplitTo()`, for each half of `MoveSelectedTabsTo()`, and for the final index in `SetTabPinnedImpl()` and `SetSplitPinnedImpl()` (after `WillSetTabPinned()`); `WillGroupTabs()` and the destination in `AddToNewGroupImpl()`, converted to an index after the move; `WillSplitTabs()` in `AddToSplitImpl()` and `WillSwapTabs()` in `UpdateTabInSplitImpl()` | 156.0.8078.47 |
| `chrome/browser/ui/tabs/tab_strip_model.cc` | `spaces/ui/keep-tab-moves-in-active-space.patch` | `ExtendSelectionTo()`, `AddSelectionFromAnchorTo()` and `GetSelectionRangeFromAnchorToIndex()` drop tabs outside the active space from Shift-click ranges; `MoveTabRelative()` (Ctrl+Shift+PgUp/PgDn) treats a neighbor in another run (`TabSpaceFilter::AreTabsInSameRun()`) like the end of the strip | 156.0.8078.47 |
| `chrome/browser/ui/browser_live_tab_context.cc` | `spaces/core/add-space-tab-helper.patch` | Include; `AddSpaceIdToExtraData()` in `GetExtraDataForTab()`. Helium's `core.patch` also edits this file | 156.0.8078.47 |
| `chrome/browser/ui/views/tabs/BUILD.gn` | `spaces/ui/hide-tabs-outside-active-space.patch` | Dep on `//chrome/browser/ui/spaces:controller` in `tab_container_impl`, on `:tab_space_filter` in `tab_strip_impl` | 156.0.8078.47 |
| `chrome/browser/ui/views/tabs/browser_tab_strip_controller.cc`, `.h` | `spaces/ui/hide-tabs-outside-active-space.patch` | Include; at the end of `InitFromModel()`, subscribe to `TabSpaceFilter::RegisterTabVisibilityChanged()` and call `TabStrip::OnTabGroupFocusChanged()`, which relayouts and ignores its arguments, then `StopAnimating()` so a switch doesn't animate the other space's tabs away, and `HideHoverCardImmediately()`; subscription member | 156.0.8078.47 |
| `chrome/browser/ui/views/tabs/tab_strip.cc` | `spaces/ui/keep-tab-moves-in-active-space.patch` | Include; `ShiftTabRelative()` (keyboard move of a focused tab) treats a neighbor in another run like the end of the strip; `MoveTabFirst()` and `MoveTabLast()` read back where the tab landed before removing it from its group (Classic, Compact, Dynamic) | 156.0.8078.47 |
| `chrome/browser/ui/views/tabs/dragging/tab_drag_controller.cc` | `spaces/ui/keep-tab-moves-in-active-space.patch` | Include; `WillDragTabs()` at the end of setting up `drag_data_` in `Init()`, `DidEndTabDrag()` in the destructor; `AttachToNewContext()` continues from the index each `InsertDetached*At()` returns instead of `CHECK_EQ`ing it, since spaces may move it; `Detach()` doesn't activate the tab after a dragged group if it is outside the active space | 156.0.8078.47 |
| `chrome/browser/ui/views/tabs/dragging/BUILD.gn` | `spaces/ui/keep-tab-moves-in-active-space.patch` | Dep on `//chrome/browser/ui/spaces:tab_space` in `impl` | 156.0.8078.47 |
| `chrome/browser/ui/views/tabs/dragging/dragging_tabs_session.cc` | `spaces/ui/keep-tab-moves-in-active-space.patch` | `CalculateGroupForDraggedTabs()` ignores the group of a neighbor outside the active space, next to the focus-mode check | 156.0.8078.47 |
| `chrome/browser/ui/views/tabs/tab_strip_layout_helper.cc` | `spaces/ui/hide-tabs-outside-active-space.patch` | Include; `SlotIsCollapsedTab()` collapses tabs outside the active space, and their group headers, before the focus-mode check (Classic, Compact, Dynamic) | 156.0.8078.47 |
| `chrome/browser/ui/views/tabs/tab_container_impl.cc` | `spaces/ui/hide-tabs-outside-active-space.patch` | Include; `SetTabSlotVisibility()` hides collapsed out-of-space tabs and their group headers; `IsTabVisible()` | 156.0.8078.47 |
| `chrome/browser/ui/views/tabs/common/BUILD.gn` | `spaces/ui/hide-tabs-outside-active-space.patch` | `impl` compiles `//chrome/browser/ui/views/spaces/space_tab_views.cc`, which needs its view headers; deps on `spaces:controller` and `spaces:tab_space_filter` | 156.0.8078.47 |
| `chrome/browser/ui/views/tabs/common/unpinned_tab_container_view_layout.cc` | `spaces/ui/hide-tabs-outside-active-space.patch` | Include; `IsChildVisibleInContainer()` and `CalculateVerticalMinimumSize()`, next to the focused-group checks (Vertical) | 156.0.8078.47 |
| `chrome/browser/ui/views/tabs/common/pinned_tab_container_view.cc` | `spaces/ui/hide-tabs-outside-active-space.patch` | Include; hide pinned tabs of other spaces in `GetMinimumSize()` and both layouts. Focus mode never filters here | 156.0.8078.47 |
| `chrome/browser/ui/views/tabs/common/tab_strip_collection_controller.cc` | `spaces/ui/keep-tab-moves-in-active-space.patch` | Include; `ShiftTabRelative()` treats a neighbor in another run like the end of the strip; `MoveTabFirst()` and `MoveTabLast()` use the index `MoveWebContentsAt()` returns (Vertical) | 156.0.8078.47 |
| `chrome/browser/ui/views/tabs/common/root_tab_collection_node.cc`, `.h` | `spaces/ui/hide-tabs-outside-active-space.patch` | Include; in `Init()`, subscribe and invalidate the pinned and unpinned containers' layouts and `HideHoverCardImmediately()`; reset in `Reset()`; subscription member | 156.0.8078.47 |
| `chrome/app/chrome_command_ids.h` | `spaces/core/add-space-commands.patch` | `IDC_SELECT_NEXT_SPACE`, `IDC_SELECT_PREVIOUS_SPACE` and `IDC_SELECT_SPACE_0`..`8`, at 40710, after Helium's `IDC_HELIUM_SERVICES_OPEN` | 156.0.8078.47 |
| `chrome/app/generated_resources.grd`, `.grd.gritdeps` | `spaces/core/add-space-commands.patch` | `<part>` for our `chrome/browser/ui/spaces/spaces_strings.grdp`, after `shortcut_input_strings.grdp`; the grdp listed in the gritdeps check | 156.0.8078.47 |
| `chrome/browser/global_keyboard_shortcuts_mac.mm` | `spaces/core/add-space-commands.patch` | Include; at the end of `GetShortcutsNotPresentInMainMenu()`, with the flag on, Cmd+Opt+Left/Right switch spaces instead of tabs, and Ctrl+1..9 (and keypad) select a space | 156.0.8078.47 |
| `chrome/browser/ui/browser_command_controller.cc` | `spaces/core/add-space-commands.patch` | Includes; the space commands in `IsReservedCommandOrKey()`, executed after `IDC_SELECT_LAST_TAB` through `SpaceController`, enabled with the tab commands in `InitCommandState()` when the flag is on | 156.0.8078.47 |
| `chrome/browser/ui/BUILD.gn` | `spaces/core/add-space-commands.patch` | Deps on `spaces:controller` and `spaces:features` in `browser_command_controller_impl` | 156.0.8078.47 |
| `chrome/browser/ui/browser_shortcuts/browser_shortcut_metadata.cc` | `spaces/core/add-space-commands.patch` | Include; labels for the space commands in `GetBrowserShortcutCommandLabel()`, which Helium's shortcuts page requires (it `DCHECK`s on a missing one) | 156.0.8078.47 |
| `components/tabs/public/tab_context_menu_command.h` | `spaces/ui/add-space-tab-menu.patch` | `CommandMoveToSpace` and `CommandAddToFavorites` at the end of the enum | 156.0.8078.47 |
| `chrome/browser/ui/tabs/tab_strip_model.cc` | `spaces/ui/add-space-tab-menu.patch` | Both new commands in `IsContextMenuCommandEnabled()`, enabled with a space filter; `ExecuteContextMenuCommand()`: `CommandMoveToSpace` is the submenu's parent, `CommandAddToFavorites` pins like `CommandTogglePinned` (with its group-deletion confirmation), then calls `TabSpaceFilter::AddTabsToFavorites()` | 156.0.8078.47 |
| `chrome/browser/ui/tabs/tab_menu_model.cc`, `.h` | `spaces/ui/add-space-tab-menu.patch` | Include; "Move to Space" submenu after the move-to-window item, from `spaces::MoveToSpaceSubMenuModel`; the Pin item's string from `spaces::GetPinMenuItemStringId()` ("Add to Favorites" / "Remove from Favorites" in the default space); "Add to Favorites" after Pin for other spaces' tabs; submenu member | 156.0.8078.47 |
| `chrome/browser/ui/tabs/existing_tab_group_sub_menu_model.cc` | `spaces/ui/add-space-tab-menu.patch` | `IsGroupInActiveSpace()`: "Add Tab to Group" lists only each window's shown groups, in `GetGroupsFromModel()` and both loops of `ShouldShowSubmenu()` | 156.0.8078.47 |
| `chrome/browser/ui/tabs/BUILD.gn` | `spaces/ui/add-space-tab-menu.patch` | Dep on `//chrome/browser/ui/spaces:menu` in `tab_menu_impl` | 156.0.8078.47 |
| `chrome/browser/ui/views/frame/vertical_tab_strip_region_view.cc`, `.h` | `spaces/ui/add-space-switcher.patch` | Include; add `SpaceSwitcherView` to the content area after the bottom button container; subtract its height in `GetTabStripDraggableBounds()`; member | 156.0.8078.47 |
| `chrome/browser/ui/BUILD.gn` | `spaces/ui/add-space-switcher.patch` | `views/spaces/space_switcher_view.*` and `space_settings_bubble.*` in the views sources of `ui`, with deps on `spaces:controller` and `spaces:spaces` | 156.0.8078.47 |
| `chrome/browser/ui/views/frame/vertical_tab_strip_region_view.cc`, `.h` | `spaces/ui/drop-tabs-on-space-switcher.patch` | Include; `GetTabDragTarget()` override returns the `SpaceSwitcherDropTarget` over a space's icon, else the base class's; drop target created next to the switcher; member | 156.0.8078.47 |
| `chrome/browser/ui/BUILD.gn` | `spaces/ui/drop-tabs-on-space-switcher.patch` | `views/spaces/space_switcher_drop_target.*` in the views sources of `ui` | 156.0.8078.47 |
| `chrome/browser/ui/views/tabs/hovercard/tab_hover_card_controller.cc`, `.h` | `spaces/ui/hide-tabs-outside-active-space.patch` | `HideHoverCardImmediately()`: closes the card without the fade-out | 156.0.8078.47 |
| `chrome/browser/ui/webui/BUILD.gn` | `spaces/tooling/add-spaces-internals.patch` | Dep on `//chrome/browser/ui/spaces:internals` in `configs`, `enable_session_service` block | 156.0.8078.47 |
| `chrome/browser/ui/webui/chrome_web_ui_configs.cc` | `spaces/tooling/add-spaces-internals.patch` | Include and `AddWebUIConfig()` for `SpacesInternalsUIConfig`, `ENABLE_SESSION_SERVICE` block | 156.0.8078.47 |
| `tools/typescript/validate_tsconfig.py` | `spaces/tooling/ts-ignore-out-of-tree-definitions.patch` | Skip `.d.ts` files outside the source tree in the undeclared-deps check | 156.0.8078.47 |

## Planned hooks

| File | Feature | Hook |
| --- | --- | --- |
| `chrome/browser/ui/views/frame/vertical_tab_strip_region_view.cc` | Spaces | Favorites grid; route scroll to the swipe handler (phase 4), next to tab group focus mode's `VerticalTabStripFocusSwipeController`, which also takes horizontal swipes |
| `chrome/browser/ui/browser_tabstrip.cc` and tab creation path | Isolation | Isolated spaces pass a SiteInstance. (New tabs join the active space from `SpaceController`, with no hook) |
| `chrome/browser/ui/tabs/tab_menu_model.cc` | Folders | Add to folder |
| `chrome/browser/prefs/browser_prefs.cc` | Archive | Register prefs, only if a pref can't be registered by its service factory. Spaces prefs are registered by `SpaceRegistryFactory` |
| `chrome/browser/ui/webui/tab_search/` | Tab Search | Space column and filter |
| `chrome/browser/chrome_content_browser_client.cc` | Isolation | Only if the spike shows a site-to-partition override is needed |

## Helium patches we depend on

| Helium patch | Why it matters |
| --- | --- |
| `helium/ui/layout/vertical.patch` | Defines the vertical sidebar we extend |
| `upstream-fixes/vertical/*.patch` | Backported vertical tab fixes; may disappear as Chromium catches up |
| `helium/core/flags-setup.patch` | Defines `helium_flag_entries.h`, the pattern our flag header follows |
| `helium/macos/fix-history-swiper-lifetime.patch` (macOS repo) | Touches the history swiper our sidebar swipe must not interfere with |
