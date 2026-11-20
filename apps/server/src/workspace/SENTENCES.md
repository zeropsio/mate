next: WS7

- WS1 — A workspace file path that leaves the workspace root is refused, and a write to it creates nothing outside the root
- WS2 — A workspace file read through a symlink that resolves outside the root is refused
- WS3 — A workspace file holding a NUL byte is refused as binary, and its contents never travel in the error
- WS4 — A write inside the workspace lands at its relative path, creating missing folders, and refreshes that root's file index
- WS5 — Review's diff preview and diff file contents refuse a working directory outside the workspace and worktree roots before any repository detection, and serve one inside
- WS6 — A workspace root must be an existing directory: a missing one is refused unless creation is asked for, and a file is refused
