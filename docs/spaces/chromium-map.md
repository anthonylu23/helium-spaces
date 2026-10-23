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
| `chrome/browser/ui/browser_live_tab_context.cc` | `spaces/core/add-space-tab-helper.patch` | Include; `AddSpaceIdToExtraData()` in `GetExtraDataForTab()`. Helium's `core.patch` also edits this file | 156.0.8078.47 |
| `tools/typescript/validate_tsconfig.py` | `spaces/tooling/ts-ignore-out-of-tree-definitions.patch` | Skip `.d.ts` files outside the source tree in the undeclared-deps check | 156.0.8078.47 |

## Planned hooks

| File | Feature | Hook |
| --- | --- | --- |
| `chrome/browser/ui/views/frame/vertical_tab_strip_region_view.cc` | Spaces | Filter tabs by active space, host switcher strip and favorites grid, route scroll to swipe handler |
| `chrome/browser/ui/views/tabs/common/unpinned_tab_container_view_layout.cc`, `pinned_tab_container_view.cc` | Spaces | Hide tabs outside the active space, next to the focused-group check (Vertical, and horizontal with `kTabStripUnification`) |
| `chrome/browser/ui/views/tabs/tab_container_impl.cc`, `tab_strip.cc` | Spaces | Same, for the legacy horizontal strip (Classic, Compact, Dynamic) |
| `chrome/browser/ui/tabs/tab_strip_model.cc` | Spaces | Next tab to activate on close, Ctrl+Tab, next to the focused-group checks |
| `chrome/browser/sessions/session_service_base.cc`, `session_restore.cc` | Spaces | Active space per window: write in `BuildCommandsForBrowser`, read when restoring the window (step 3) |
| `chrome/browser/ui/tabs/vertical_tab_strip_state_controller.h` | Spaces | Read collapse/width state next to space state |
| `chrome/browser/ui/browser_tabstrip.cc` and tab creation path | Spaces, Isolation | New tabs join the active space; isolated spaces pass a SiteInstance |
| `chrome/browser/ui/browser_commands.cc` | Spaces | Ctrl+Tab within space, space switching commands |
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
