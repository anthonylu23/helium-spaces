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
| `chrome/browser/ui/views/tabs/browser_tab_strip_controller.cc`, `.h` | `spaces/ui/hide-tabs-outside-active-space.patch` | Include; at the end of `InitFromModel()`, subscribe to `TabSpaceFilter::RegisterTabVisibilityChanged()` and call `TabStrip::OnTabGroupFocusChanged()`, which relayouts and ignores its arguments, then `StopAnimating()` so a switch doesn't animate the other space's tabs away; subscription member | 156.0.8078.47 |
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
| `chrome/browser/ui/views/tabs/common/root_tab_collection_node.cc`, `.h` | `spaces/ui/hide-tabs-outside-active-space.patch` | Include; in `Init()`, subscribe and invalidate the pinned and unpinned containers' layouts; reset in `Reset()`; subscription member | 156.0.8078.47 |
| `chrome/browser/ui/webui/BUILD.gn` | `spaces/tooling/add-spaces-internals.patch` | Dep on `//chrome/browser/ui/spaces:internals` in `configs`, `enable_session_service` block | 156.0.8078.47 |
| `chrome/browser/ui/webui/chrome_web_ui_configs.cc` | `spaces/tooling/add-spaces-internals.patch` | Include and `AddWebUIConfig()` for `SpacesInternalsUIConfig`, `ENABLE_SESSION_SERVICE` block | 156.0.8078.47 |
| `tools/typescript/validate_tsconfig.py` | `spaces/tooling/ts-ignore-out-of-tree-definitions.patch` | Skip `.d.ts` files outside the source tree in the undeclared-deps check | 156.0.8078.47 |

## Planned hooks

| File | Feature | Hook |
| --- | --- | --- |
| `chrome/browser/ui/views/frame/vertical_tab_strip_region_view.cc` | Spaces | Filter tabs by active space, host switcher strip and favorites grid, route scroll to swipe handler |
| `chrome/browser/ui/tabs/vertical_tab_strip_state_controller.h` | Spaces | Read collapse/width state next to space state |
| `chrome/browser/ui/browser_tabstrip.cc` and tab creation path | Isolation | Isolated spaces pass a SiteInstance. (New tabs join the active space from `SpaceController`, with no hook) |
| `chrome/browser/ui/browser_commands.cc` | Spaces | Space switching commands |
| `chrome/app/chrome_command_ids.h`, macOS accelerator tables | Spaces | Command ids and shortcuts |
| `chrome/browser/ui/tabs/tab_menu_model.cc` | Spaces, Folders | Move to space, pin to favorites, add to folder |
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
