# Agent guidelines for helium-spaces

Read `docs/spaces/status.md` first, then the docs it points to for the task.

## Ground rules

- This is an independent GPL-3.0 fork. Never push to, open PRs against, or file
  issues on any imputnet repository. The upstream remotes are fetch-only for us.
  Helium's maintainers do not accept AI-assisted contributions; respect that.
- Do not commit without the human's approval. Group commits by scope.
- Work on a branch, not `main`, unless told otherwise.

## Repo layout

- This repo (`helium-spaces`): macOS packaging, `dev.sh` tooling, our docs,
  and **all of our feature patches**, under `patches/spaces/`.
- `helium-chromium/` submodule (`helium-spaces-core`): Helium's shared patch
  series. We only touch it to pin or hotfix Helium itself.
- `build/` (ignored): Chromium source in `build/src`, output in
  `build/src/out/Default`. Never commit anything from it.

## Patch rules

- One feature per patch. Our patches go in the `# helium-spaces` block at the
  end of this repo's `patches/series`, so they apply after every Helium patch.
- Patch folders: `patches/spaces/{core,ui,archive,tooling}/`. Never name one
  `build/`; Helium's `.gitignore` ignores every `build/` folder.
- New logic goes in new files under `chrome/browser/ui/spaces/` or
  `chrome/browser/ui/views/spaces/`. Edits to existing Chromium files are thin
  hooks that call into those files.
- Never edit `.patch` files by hand. Edit the source in `build/src` with quilt,
  then `quilt refresh`. See `docs/spaces/development.md`.
- Everything new is gated behind the `HeliumSpaces` feature
  (`chrome://flags/#helium-spaces`), disabled by default.
- New files carry the GPL-3.0 header used by Helium's own new files.
- Update `docs/spaces/chromium-map.md` whenever a patch starts or stops
  touching a Chromium file.
- Record anything deferred, or decided on purpose (a known gap, a behavior
  chosen over an alternative, an unverified check), in
  `docs/spaces/deferred.md` before committing the work it came from.

## Searching Chromium

`build/src` is ~30M lines. Do not grep it blindly. Scope searches to
`chrome/browser/ui/`, `chrome/browser/sessions/`, or the files listed in
`docs/spaces/chromium-map.md`, or use https://source.chromium.org for
cross-references.

## Verifying changes

1. `he build`, then `node --experimental-websocket devutils/spaces_smoke.mjs`
   (headless; extend it as features land). `he run` for anything visual.
   Pure logic gets gtest coverage in `spaces_unittests` (see
   `docs/spaces/development.md`); Chromium's own test targets can't build here.
2. `he unmerge`, then `he validate series` and `he validate config`.
3. `he validate patches` only works on an unmodified Chromium tree, so run it
   only during an upstream sync, right after `he presetup`.
4. In scripts, run quilt as `zsh -c 'source spaces-dev.sh; cd build/src &&
   quilt --quiltrc - ...'`. Both parts matter: the alias only exists in
   interactive shells, and without the `QUILT_*` variables `dev.sh` exports,
   `quilt refresh` writes `Index:` and `src.orig/` headers.
