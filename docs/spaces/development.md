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

`dev.sh` defines `quilt` as an alias for `quilt --quiltrc -`, which is what
makes patches come out in Helium's `a/` `b/` format with no `Index:` lines.
Aliases do not expand in scripts or one-shot `zsh -c` commands, so scripts and
agents must call `quilt --quiltrc -` explicitly.

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
| Patches refresh with `Index:` and `src.orig/` headers | `quilt` alias not active | Use an interactive shell after `source spaces-dev.sh`, or `quilt --quiltrc -` |

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

## Smoke test

`devutils/spaces_smoke.mjs` launches the dev build headless with a throwaway
profile and checks it over the DevTools protocol. Today it checks that the
browser starts and that `chrome://flags/#helium-spaces` exists, is named
"Helium Spaces", and is off by default. Add a check for every feature as it
lands.

```bash
node --experimental-websocket devutils/spaces_smoke.mjs
```

The flag is only needed on Node 20 and 21; Node 22+ has WebSocket built in.

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
