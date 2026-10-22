# helium-spaces

A personal fork of [Helium](https://github.com/imputnet/helium) that adds
Arc-style Spaces to a single window, per-space login isolation, and tab
organization features. Working name; a public build will get its own name and
icon before release.

This repo is a fork of [imputnet/helium-macos](https://github.com/imputnet/helium-macos)
(macOS packaging and dev tooling). Our feature patches live in
[patches/spaces/](patches/spaces/). Helium's shared patches come from the
`helium-chromium` submodule, which points at our fork of the core repo,
[anthonylu23/helium-spaces-core](https://github.com/anthonylu23/helium-spaces-core).

**This is not an official Helium build and is not affiliated with imputnet.**
Nothing from this fork is contributed back upstream; see [AGENTS.md](AGENTS.md).

## Docs

| Doc | What it covers |
| --- | --- |
| [docs/spaces/spec.md](docs/spaces/spec.md) | What we are building, architecture, phased plan |
| [docs/spaces/status.md](docs/spaces/status.md) | Current phase, what is done, next steps |
| [docs/spaces/development.md](docs/spaces/development.md) | Setup, build, patch workflow, syncing upstream |
| [docs/spaces/chromium-map.md](docs/spaces/chromium-map.md) | Chromium files each feature hooks, and the version they were verified on |
| [docs/spaces/rebase-log.md](docs/spaces/rebase-log.md) | Cost of every upstream sync |
| [docs/building.md](docs/building.md) | Upstream Helium build guide |

## Quick start

```bash
git clone --recurse-submodules https://github.com/anthonylu23/helium-spaces.git
cd helium-spaces
source spaces-dev.sh   # zsh only; wraps Helium's dev.sh
he setup               # download Chromium, apply patches, configure
he build               # component build, several hours the first time
he run                 # launches with its own dev profile
node --experimental-websocket devutils/spaces_smoke.mjs   # headless checks
```

See [docs/spaces/development.md](docs/spaces/development.md) for prerequisites.

## License

GPL-3.0, inherited from Helium. See [LICENSE](LICENSE). Content imported from
ungoogled-chromium keeps its [BSD 3-Clause license](LICENSE.ungoogled_chromium).
Helium's name and icons belong to imputnet and are not licensed for use in a
public build of this fork.
