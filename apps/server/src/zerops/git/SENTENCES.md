next: GT18

- GT1 — A token handed to the remote shell keeps its meaning: a shell-safe token goes as it is and any other is single-quoted, a single quote included, so a commit message survives intact
- GT2 — Git at a mount, named by `-C` after configuration flags or by its working directory, runs on that mount's host as `git -C` the same path below the remote root; git outside every mount, at a name that only begins like one or climbing out with `..`, and every command that is not git are left alone
- GT3 — `--git-dir` and `--work-tree` values are mapped onto the remote root in both spellings, while a workspace path that is a plain argument, as in a commit message, is never rewritten
- GT4 — Only `GIT_*` variables other than the trace2 streams, and `LC_ALL`, cross to the remote side, never the server's own environment, and no env prefix is sent when none survives
- GT5 — No git argv that leaves the server carries a mount path: git inside a mount spawns ssh to that mount's host, its `GIT_INDEX_FILE` mapped onto the host's own disk
- GT6 — The ssh invocation pins every connection option rather than inheriting `~/.ssh/config`, and ends with the host and exactly one remote command string
- GT7 — Only `rev-parse --show-toplevel` and `worktree list` have their stdout mapped back to the mount, at a path position only; every other output passes as git wrote it
- GT8 — A pipeline that names a mount is refused before anything runs
- GT9 — Git run for an unmounted earlier binding goes over ssh guarded by that binding's own service identity, never the current one's
- GT10 — Outside a Zerops environment, and for every command that is not git, the spawner hands the command to the platform untouched, and layered in front of the platform spawner it still reaches it
- GT11 — Git that names a workspace path while the mount table is unread, an attachment there is unidentified, or its git directory lies in a mount is refused before anything runs
- GT12 — Git at a workspace path no mount holds, in a mount table read afresh for that spawn, runs on this container's own disk below the workspace root as its ceiling, while a path mounted since the last read goes over ssh to its host
- GT13 — Local git never runs against a mount named through `..`, `.`, `//` or a relative git directory
- GT14 — A git failure passes through as its own exit code, while ssh's 255 is logged once as a transport failure naming the host
- GT15 — At most four git sessions run at once on one host, and one host's sessions never hold back another's
- GT16 — A remote probe reads reachable with the number of branches the remote advertised, an empty repository included, for the remote the caller named or else origin
- GT17 — A remote that refuses is a success that reads unreachable with the server's own `remote:` line, else git's first line, at most 200 characters, while a probe that could not run at all is an error
