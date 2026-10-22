# Source this from zsh instead of dev.sh: `source spaces-dev.sh`, then `he ...`.
# It sets up the environment helium-spaces builds need, then loads Helium's
# dev.sh unchanged so upstream tooling keeps working.

if [ -z "${ZSH_VERSION:-}" ]; then
    echo "spaces-dev.sh must be sourced from zsh (dev.sh relies on zsh's \$0)" >&2
    return 1
fi

# Helium's scripts expect Python 3.13; prefer Homebrew's over any older python3.
if [ -d /opt/homebrew/opt/python@3.13/libexec/bin ]; then
    export PATH="/opt/homebrew/opt/python@3.13/libexec/bin:$PATH"
else
    echo "warn: python@3.13 not found; run: brew install python@3.13" >&2
fi

source "${0:A:h}/dev.sh"
