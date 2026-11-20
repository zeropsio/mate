next: PL10

- PL1 — An empty Claude home, `~/.claude` and its expanded path are one Claude home with one continuation group, and an empty home leaves Claude's environment as given
- PL2 — A configured Claude home is resolved from `~`, reaches Claude as `CLAUDE_CONFIG_DIR`, and names the continuation group and the capability cache key, which also differs per working directory
- PL3 — With no configured Claude home an inherited `CLAUDE_CONFIG_DIR` names the home and its continuation group, and a configured home outranks it
- PL4 — Without a shadow home Codex runs and continues in its one home, and with one it continues in the shared home and runs in the shadow home
- PL5 — A Codex shadow home that is the shared home, or that holds a real file where a shared entry belongs, is refused
- PL6 — A Codex shadow home links the shared home's sessions, config and MCP OAuth locks, replacing a lock directory Codex made locally, while its auth and models cache stay its own files and Codex's local log, memories and tmp directories stay as they are
- PL7 — A borrower of an OpenCode server whose process has exited or stopped running gets a newly started server, and the dead one is closed
- PL8 — OpenCode's server starts with the keys stored on its instance in its environment
- PL9 — On Linux and macOS OpenCode's installer directory is appended to the instance's PATH, after the entries already there, so an OpenCode found on PATH wins, and on Windows the PATH is left as it is
