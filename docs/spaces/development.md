# Development

## Repos and remotes

| Checkout | origin (ours) | upstream (fetch only) |
| --- | --- | --- |
| `./` | anthonylu23/helium-spaces | imputnet/helium-macos |
| `./helium-chromium` | anthonylu23/helium-spaces-core | imputnet/helium |

Both repos use the same branch model: `main` carries our work on top of
upstream; feature work happens on `spaces/<topic>` branches and merges into
`main`. Almost all work is in the outer repo. When the core repo does change,
push its commit first, then bump the submodule pointer in the outer repo.

Never push to `upstream`. To make that mechanical:

```bash
git remote set-url --push upstream DISABLED
git -C helium-chromium remote set-url --push upstream DISABLED
```

## Prerequisites (macOS, Apple Silicon)

| Need | Notes |
| --- | --- |
| Xcode 26 + Metal toolchain | `xcodebuild -downloadComponent MetalToolchain`. Upstream CI uses 26.5 |
| Homebrew packages | `brew install python@3.13 wget zstd coreutils readline quilt gnu-sed ccache` |
| Python packages | `python3.13 -m pip install --user --break-system-packages requests pillow` |
| Disk | ~150 GB free for source, output and download cache |
| RAM | 32 GB recommended; 18 GB works but linking is slow |

`brew unlink binutils` if Homebrew binutils is installed; the build must use
Xcode's.

ccache is picked up automatically by `he configure`. Give it room for a full
Chromium build, otherwise rebuilds after a rebase get no benefit:

```bash
ccache --max-size=30G
```

## Environment

Always load the dev environment through our wrapper, from zsh:

```bash
source spaces-dev.sh
```

It puts Homebrew's Python 3.13 first on `PATH` and then sources Helium's
`dev.sh` unchanged. Run `he` alone to list commands.

`dev.sh` defines `quilt` as an alias for `quilt --quiltrc -` and exports
`QUILT_*` variables (`devutils/set_quilt_vars.sh`). The variables are what make
patches come out in Helium's `a/` `b/` format with no `Index:` lines; the
`--quiltrc -` makes quilt read them. Aliases do not expand in scripts or
one-shot `zsh -c` commands, so scripts and agents must do both:

```bash
zsh -c 'source spaces-dev.sh; cd build/src && quilt --quiltrc - refresh'
```

`spaces-dev.sh` also puts Chromium's bundled `clang-format` on `PATH`, which
`he format` needs.

## First-time setup and build

```bash
he setup   # download Chromium tarball, prune, merge + push all patches, gn gen
he build   # component build of chrome + chromedriver
he run     # launches build/src/out/Default/Helium.app with a dev profile
```

`he setup` refuses to run if `build/src/out` exists. `he reset` wipes `build/src`
(the download cache is kept). The dev profile lives in
`~/Library/Application Support/net.imput.helium.dev`, separate from any real
Helium install.

Dev builds swap `is_official_build` for `is_component_build` and skip domain
substitution, so patches must never depend on substituted domains.

### Known environment issues

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Undeclared dependencies to definition files ... node_modules/buffer/index.d.ts` | A `node_modules` folder above the checkout (here `$HOME`) leaks into TypeScript module resolution | Fixed by `patches/spaces/tooling/ts-ignore-out-of-tree-definitions.patch` |
| Patches refresh with `Index:` and `src.orig/` headers | `QUILT_*` variables from `dev.sh` not set | `source spaces-dev.sh` first, then `quilt --quiltrc -` |
| `he format`: `Failed to run "clang-format ..."` | No `clang-format` on `PATH` | `spaces-dev.sh` adds `build/src/buildtools/mac_arm64-format` |
| `browser_tests`, `unit_tests`, `base_unittests` fail on missing inputs | The `-base` source tarball has no test data | Use `spaces_unittests`, below |

## Where patches live

All of our patches are in this repo, in `patches/spaces/`, listed in the
`# helium-spaces` block at the end of `patches/series`. During `he merge`,
Helium's core series is prepended to this repo's series, so our patches apply
last, on top of every core and macOS patch. They become macOS-platform patches
in ungoogled-chromium terms; that is deliberate, since other platforms are a
non-goal and it keeps new patches at the top of the quilt stack.

The core fork (`helium-chromium/`) is only edited to pin Helium to a known
commit or to hotfix a Helium patch that breaks our build.

## Making a patch

After `he setup`, every patch is applied in `build/src` and
`patches/series.merged` holds the full list.

```bash
cd build/src
quilt top                                      # should be our last patch, or the last macOS patch
quilt new spaces/ui/<name>.patch               # path is relative to patches/
quilt add path/to/file.cc path/to/new_file.h   # BEFORE editing each file
# edit, then from the repo root:
he build && he run
cd build/src && quilt refresh
```

A patch created at the top of the stack stays in this repo's series when you
`he unmerge`. Then check that the line landed in the `# helium-spaces` block.

Editing an existing patch of ours:

```bash
cd build/src
quilt pop spaces/ui/<name>.patch     # pops everything above it
quilt add path/to/other_file.cc      # only for files the patch doesn't touch yet
# edit, then
quilt refresh && quilt push -a
```

Before committing:

```bash
he format                 # clang-format the topmost patch
he build
node --experimental-websocket devutils/spaces_smoke.mjs
he unmerge                # moves patches back to their repos
he validate series
he validate config
```

`he validate patches` checks that the series applies to an **unmodified**
Chromium tree, so it is only meaningful during an upstream sync, right after
`he presetup` and before `quilt push`.

After `he unmerge`, `quilt` commands no longer see the merged series. Run
`he merge` before the next quilt session; the source tree itself is untouched
by merge and unmerge, so no rebuild is needed.

## Unit tests

Chromium's own test targets can't build from the tarball we use, so pure logic
(no `Profile`, `Browser` or prefs) is kept in small classes and tested by our
own gtest target. Add new `*_unittest.cc` files to `spaces_unittests` in
`chrome/browser/ui/spaces/BUILD.gn`.

```bash
zsh -c 'source spaces-dev.sh; cd build/src && \
  SISO_PATH=$_siso_path python3 $_depot_tools_dir/autoninja.py -C out/Default spaces_unittests'
build/src/out/Default/spaces_unittests
```

The first build takes a few minutes (base's test support); after that it is
seconds.

## Smoke test

`devutils/spaces_smoke.mjs` launches the dev build headless with a throwaway
profile and checks it over the DevTools protocol. Today it checks that the
browser starts, that `chrome://flags/#helium-spaces` exists and is off by
default, and, with the flag on, that the profile gets one default space whose
id survives a restart, that tabs keep their space through restarts,
session-file rewrites and reopen-closed-tab, and that switching and tab
commands follow the `SpaceController` rules. Add a check for every feature as
it lands.

It reads state from `chrome://spaces-internals` (flag on only), which prints
spaces and tabs as JSON and takes `chrome.send()` messages; see
`spaces_internals_ui.h`. Things that bit us writing it:

- Headless mode won't open a `chrome://` URL from the command line. Start on
  `about:blank` and navigate.
- A background tab takes seconds to load, and a restored one has no title
  until it does. Poll, and identify tabs by URL.
- Session commands are written 2.5 s after a change, and a quick headless quit
  drops any still pending. `close({ waitForSessionSave: true })` waits first.
- Restart with `--restore-last-session` to get the tabs back. A startup URL
  also opens a new tab, which joins the active space and becomes active, so
  checks about the restored active space pass `attachTo` to `launch()` and
  drive a restored `chrome://spaces-internals` tab instead.
- Keyboard shortcuts go through `runCommand`, not CDP key events, which only
  reach the page.
- The tab context menu is built for real by `tabMenu` (its items, with
  submenus, appear in the state as `tab_menu`) and run by `tabMenuItem`,
  which follows a path of labels. Labels are the Mac's Title Case ones.
  Untitled groups are labeled from their tabs' titles, which a background
  test tab may not have yet.
- `collapseGroup` and `dropOnSpace` make the model calls the views make when
  a group is collapsed and when tabs are dropped on a switcher icon.
- Every DevTools call times out after 30 s. A bug that closes the tab the test
  drives otherwise hangs the run.

To check that a hook is needed, remove it, rebuild, and confirm a check fails.
Rebuild again after putting it back: restoring the source doesn't restore the
binary.

```bash
node --experimental-websocket devutils/spaces_smoke.mjs
# One section, with the browser's stderr (FATAL check failures land there):
SPACES_SMOKE_ONLY=checkOrder SPACES_SMOKE_STDERR=1 node --experimental-websocket devutils/spaces_smoke.mjs
```

The flag is only needed on Node 20 and 21; Node 22+ has WebSocket built in.

Tab order checks don't just look at where a tab ends up. `SpaceController`
fixes a broken order in a posted task, so by the time the page reloads the
order may look right. `chrome://spaces-internals` reports each window's
`order_fixes`, and every order check fails if it went up.

Headless mode draws no tab strip, so `devutils/spaces_screenshots.mjs` opens a
real window instead, builds a fixture of favorites, space-pinned tabs and a
tab group across three spaces, and saves a screenshot for each of the four
layouts and three spaces. The terminal running it needs Screen Recording
permission (System Settings > Privacy & Security); without it `screencapture`
fails or captures black, and the script still checks that nothing crashes.

```bash
node --experimental-websocket devutils/spaces_screenshots.mjs out-dir
```

## Syncing with upstream Helium

Do this when Helium ships a release. Record the result in `rebase-log.md`.

```bash
git fetch upstream && git -C helium-chromium fetch upstream
git -C helium-chromium merge upstream/main   # clean unless we hotfixed core
git merge upstream/main                      # conflicts are usually only in patches/series
git add helium-chromium                      # record the new core pointer
he reset && he setup                         # fresh Chromium for the new milestone
```

If our patches fail to apply during `he setup`, fix them one at a time:

```bash
cd build/src
quilt push -f            # force-apply the failing patch, leaving .rej files
# resolve each .rej by hand, delete it, then
quilt refresh && quilt push -a --refresh
```

Then build, run the smoke checklist in `status.md`, refresh
`chromium-map.md`, and log the time spent.
