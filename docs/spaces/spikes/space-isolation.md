# Spike: per-space isolation with StoragePartitions

Phase 5 in `spec.md`. Question: can a space get its own cookie jar and site
storage by putting its tabs in a non-default StoragePartition of the same
Profile, and what breaks? The answer decides Gate 2: ship, ship behind a
warning, or drop.

Status (2026-10-25): the prototype (`spaces/core/isolate-space-storage.patch`
on branch `spaces/isolation-spike`) is built. The scripted experiments pass,
and Codex ran most of the hands-on ones; see Results. Left: the experiments
that need an unlocked screen (E3 clicks, E10, E13), real accounts (E5, the
user), and the Gate 2 decision.
Paths are under `build/src` at Chromium 156.0.8078.47. [V] = read in the
source, [I] = inferred, to be settled by an experiment.

## What the source says

### A normal tab can live in a fixed partition

- `SiteInstance::CreateForFixedStoragePartition(context, url, config)`
  (`content/public/browser/site_instance.h:255`) starts a BrowsingInstance
  pinned to a non-default partition. Only guests are required to be fixed;
  nothing rejects a fixed partition in an ordinary tab [V].
- Chrome already does this for an ordinary tab, on Android:
  `CreateWebContentsWithSeparateStoragePartitionForExperiment` in
  `chrome/browser/android/content/web_contents_factory.cc:43` [V]. It is the
  only precedent found; no design doc or bug covers desktop tabs.
- `StoragePartitionConfig::Create(context, domain, name, in_memory)`: domain
  `[a-z]+`. On disk under `Storage/ext/<domain>/…`. One domain per space lets
  `BrowserContext::AsyncObliterateStoragePartition(domain)` delete exactly
  one space's data.
- `ChromeContentBrowserClient::GetStoragePartitionConfigForSite()` is keyed
  by site only, but a fixed SiteInstance always carries its partition, so it
  needs no hook [V].

### Where a tab stays in its partition, and where it falls out

| Path | Result |
| --- | --- |
| Same-tab navigations, cross-site, redirects, BrowsingInstance swaps, subframes, shared workers | Kept [V; redirects I] |
| `window.open` with an opener; duplicating a tab | Kept [V] |
| noopener popups (`rel=noopener`, implicit `target=_blank`, COOP) | Default partition: `WebContentsImpl::CreateNewWindow()` only keeps the partition for guests (`web_contents_impl.cc:5776`) [V] |
| Links opened in a new tab, Cmd+T, `chrome.tabs.create` | Default: `CreateTargetContents()` in `browser_navigator.cc:572` uses `tab_util::GetSiteInstanceForNewTab()` [V] |
| Session restore, Cmd+Shift+T | Default: the partition isn't saved; `CreateRestoredTab()` in `browser_tabrestore.cc:77` creates the tab with no SiteInstance [V]. Our space id is in the tab's extra data, so the partition can be derived from it |
| Prerender activation | Probably default [I] |
| Tab discard (Memory Saver; legacy path on Mac) | Probably default: `TabLifecycleUnit::FinishDiscard()` makes a new WebContents [I] |
| Moving a tab to another space | Needs a new WebContents with the history copied over, as the spec expected (`CopyStateFrom()` keeps the old SiteInstances, so restore from serialized entries) [V/I] |

### What is shared and what breaks

| Area | Expected |
| --- | --- |
| Passwords, autofill, permissions, content settings | Keyed by profile, so shared across spaces, as the spec wants [I] |
| Downloads | Use the frame's partition, also on resume [V] |
| Content scripts, declarativeNetRequest (uBlock Origin Lite), webRequest | Per profile, so expected to work [I]. When the first such extension is enabled, only the default partition's loaders are reset (`web_request_api.cc:1150`), so tabs already open in a space may go unfiltered until they navigate [V] |
| `chrome.cookies` | Only ever sees the default jar, with store ids `"0"`/`"1"` (`cookies_api.cc:103`) [V]. Cookie managers and cleaners won't see spaces |
| Session cookies | Not saved across restarts for non-default partitions (`profile_network_context_service.cc:1446`) [V], so logins held in session cookies end at a restart. Needs a hook |
| Notifications and web push | Denied: `PermissionUtil::IsPermissionBlockedInPartition()` (`components/permissions/permission_util.cc:676`) denies an undelegated permission, and notifications is the only one, to a page outside its origin's default partition, so a grant made in Settings or in another space doesn't apply [V, E14]. Push needs that permission, and its messages are routed to the partition the origin maps to, the default (`push_messaging_router.cc:115`) [I] |
| Clear browsing data | Default partition only, unless told otherwise [I] |
| Partition garbage collection | After an extension's data is deleted, the next startup deletes every `Storage/ext` folder not owned by an extension or IWA (`garbage_collect_storage_partitions_command.cc:73`) [V]. Would wipe spaces' logins. Needs a hook |
| DevTools | Page-level cookies and network use the tab's partition; the browser-level `Storage.getCookies` sees only the default jar [V]. The smoke test must read cookies per page |
| Memory | Each partition has its own network context and cache |

## Prototype

Behind `HeliumSpaces`, with no UI: `chrome://spaces-internals` gets a
command to mark a space isolated. New logic in
`chrome/browser/ui/spaces/space_partition_manager.{h,cc}` (space id to
partition config, and the SiteInstance for a new tab). Four hooks:

1. `CreateTargetContents()` in `chrome/browser/ui/navigator/browser_navigator.cc`:
   with no opener, a new tab in an isolated space gets its partition. The
   space is the source tab's, else the window's active space. Covers Cmd+T,
   links opened in new tabs and `chrome.tabs.create`.
2. `WebContentsImpl::CreateNewWindow()` in `content/`: a noopener popup from
   a fixed partition stays in it (about three lines; our only content hook).
3. `CreateRestoredTab()` in `chrome/browser/ui/browser_tabrestore.cc`: create
   the tab in its space's partition, read from the extra data before the
   WebContents exists.
4. `IsPrerender2Supported()` in `browser_web_contents_delegate.cc`: no
   prerender in isolated tabs.

Isolation v1, if the spike passes, adds: discard (hook `FinishDiscard()` or
turn on `kWebContentsDiscard`), session cookies, the garbage-collection
allowlist, clearing a space's data, the webRequest loader reset, moving a tab
between spaces, and, optionally, sessionStorage on restore. About 10 to 14
hooks in all, 1 to 4 in `content/`.

Work on branch `spaces/isolation-spike`; the prototype patch doesn't join
the series on `main` until Gate 2 says ship.

## Experiments

A = an isolated space, B = a space using the default jar. The automated
ones use a local HTTP server instead of a public site, and
`chrome://process-internals`, which prints each SiteInstance's partition, as
the oracle. Real logins need a person.

| # | Experiment | Pass | How |
| --- | --- | --- | --- |
| E1 | Set a cookie in A, read it in B and A | B doesn't see it; A does; process-internals shows A's partition | Smoke |
| E2 | In A: redirect cross-site, type a URL, Back/Forward | A's cookie throughout | Smoke |
| E3 | In A: `window.open` with and without opener, `target=_blank`, Cmd-click, middle-click, "Open link in new tab" | Every new tab is in A | Smoke + hands-on (clicks) |
| E4 | Restart with session restore; close an A tab and reopen it | Back in A; a session cookie survives (needs the v1 hook) | Smoke |
| E5 | Two accounts of one site (e.g. GitHub) in A and B side by side; restart; "Sign in with Google" on a third-party site in A | Both stay logged in as the right account; the sign-in popup finishes in A | The user |
| E6 | uBlock Origin Lite on an ad-block test page in A and B; then enable it with an A tab already open | Same blocking; note anything unfiltered in the second case | Hands-on |
| E7 | Test extension: content script on all frames at document_start, and `scripting.executeScript` | Runs in A's frames | Smoke (unpacked extension) |
| E8 | Test extension: `chrome.cookies.getAll`, `getAllCookieStores`, `onChanged` while A sets a cookie | Record it; expected blind to A | Smoke |
| E9 | `chrome.tabs` query, update, reload, duplicate, create on A tabs | Normal, and they stay in A | Smoke |
| E10 | Save a password in A; fill it in A and B; an address form | Saves and fills in both | Hands-on |
| E11 | Download a file that needs A's cookie; pause, restart, resume | Completes | Smoke + hands-on |
| E12 | Video and Document Picture-in-Picture in A | Work; the Document PiP window is in A | Hands-on |
| E13 | DevTools Application > Cookies and Network on an A tab | Shows A's jar | Hands-on |
| E14 | Grant notifications in A, check B | Shared, by design | Smoke |
| E15 | Service worker and push test page in A | Worker registered in A; record whether push and notification clicks work (expected not) | Hands-on |
| E16 | Speculation-rules prerender in A | After activation the tab is still in A | Smoke |
| E17 | Discard an A tab in `chrome://discards`, reactivate | Still in A (needs the v1 hook) | Smoke |
| E18 | Move an A tab to B | Reloads in B with its history | Smoke, once v1 adds it |
| E19 | Clear cookies; force partition GC and restart | Record whether A is cleared; A's folder survives GC (needs the v1 hook) | Smoke |
| E20 | New Tab page, `chrome://settings`, the uBOL dashboard in an A tab | No crash; record which storage the extension page uses | Hands-on |

## Results

### Scripted (`checkIsolation`, 2026-10-25)

All its checks pass, with the four prototype hooks and nothing else.

| # | Seen |
| --- | --- |
| E1 | A new tab of an isolated space opens in the space's partition (`heliumspace…`). It sees only that space's cookies, and a default-space tab only the default jar's |
| E2 | A cross-site navigation by script followed by a redirect stays in the partition, with its cookies |
| E3, scripted part | `window.open` with and without opener, and a `target=_blank` link, each open a tab in the partition, with its cookies. The clicks are left to the hands-on run |
| E4 | After a restart, the isolated space's tabs are back in its partition (hook 3) and send its persistent cookie; the default space's stay in the default jar. A reopened tab (Cmd+Shift+T) is back in the partition. The session cookie is lost, as the source predicted: the v1 session-cookie hook is needed |
| E20, partly | The New Tab page of an isolated space opens in its partition without trouble |

Notes for the hands-on run and for v1:

- Restored tabs are in the right partition before they load: the partition
  comes from the space id in the tab's extra data, not from the page.
- A restored page may come from the HTTP cache without asking the server, so
  the test site sends `Cache-Control: no-store`; a cookie check on a
  restored tab is only meaningful that way.
- `openLink` in `chrome://spaces-internals` opens a tab the way a link opened
  in a new tab does, from the active tab with no opener, and goes through
  hook 1.

### Hands-on (Codex, 2026-10-25)

Report and evidence: `~/Desktop/spaces-isolation/report.md` and `run-2/`.
The screen was locked, so the browser was driven over DevTools: the page
APIs, a test extension and `chrome://spaces-internals`, plus Cmd+T sent to
the browser's process. Native clicks, menus and screenshots weren't possible.

| # | Result | Seen |
| --- | --- | --- |
| E3, clicks | Untested | Cmd-click, middle-click and the link menu need an unlocked screen |
| E5, fake accounts | Pass | alice in A and bob in B, side by side, both right after a restart. A provider popup from A logged in with A's provider cookie, posted back and closed; the provider's cookie never showed in B |
| E6 | Pass | uBlock Origin (not Lite) blocks the same requests in A and B. After it was turned off and on again, the first navigation in an open A tab, about 200 ms later, went unfiltered; later ones were filtered. Whether that is startup delay or the loader reset seen in the source isn't settled |
| E7 | Pass | A content script at `document_start` and `scripting.executeScript` ran in A's frame and its iframe |
| E8 | As expected | `chrome.cookies` sees only the default jar: one store, listing A's tabs under it; `onChanged` misses A's cookies |
| E9 | Pass | `chrome.tabs` update, reload, duplicate and create keep A's partition and cookies |
| E10 | Untested | Save and fill prompts need the screen |
| E11 | Pass | A download that needs A's cookie completes; a 16 MiB download paused, restarted and resumed from `chrome://downloads` with A's cookie and a `Range` header, byte-exact |
| E12 | Pass | Video PiP works; a Document PiP window is in A's partition and reads A's cookie |
| E13 | Untested | The DevTools panels need the screen. Over the protocol, a page's cookies are A's |
| E14 | **Fail** | A notification grant made in Settings applies in B but not in A, even after a reload. Cause: the permission check above |
| E15 | Recorded | A's service worker registers under A's `Storage/ext/heliumspace…` folder. Push subscription and `showNotification` fail, for lack of the notification permission |
| E16 | Recorded | No prerender ran (hook 4); the page activated normally in A |
| E17 | Fail, expected | A discarded tab keeps its space but loses its partition. The v1 discard hook |
| E20 | Pass | New Tab (by Cmd+T), Settings, Extensions and the uBlock dashboard load in A's partition, with no crash |

No crash or DCHECK. Once, with a download paused, the browser didn't quit
within 10 s of `Browser.close` and was killed; the next launch offered
"Restore pages?". Cause unknown and not tied to isolation yet. Across the 47
spaces-internals states saved, the tab order was never broken or fixed.

What this means for Gate 2: logins, popups, downloads and the content
blocker work per space. Notifications and push don't, and `chrome.cookies`
can't see a space's jar. Notifications could be fixed with one more hook,
treating a space's partition as its origin's home in
`IsPermissionBlockedInPartition()`; push delivery would still need its
routing changed.

## Gate 2

- **Ship**: E1 to E5 pass with the prototype hooks, nothing crashes, and the
  extension results (E6 to E9) are what users would expect, or are fixed by
  v1's hooks.
- **Ship behind a warning**: logins isolate, but extensions see the wrong jar
  or push breaks. Isolation becomes an advanced per-space setting that says
  so, as the spec's fallback.
- **Drop**: logins leak between spaces through a path no hook can close, or
  core features (passwords, downloads, uBlock) break.

Open risks: internal pages and extension pages inside a fixed partition
(E20), and Helium's own ways of creating tabs that skip `Navigate()`. Our
dev build isn't an official build, so DCHECKs are on and catch misuse of a
fixed partition during the experiments.
