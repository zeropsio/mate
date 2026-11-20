next: BG6

- BG1 — A client's scope lease lasts exactly as long as its Mate socket: a quiet open socket keeps it, closing the socket ends it, and another session's lease under the same client number stays
- BG2 — A visible client counts as in use while focused and for 45 seconds after its last interaction on the server's clock, and losing focus does not renew it
- BG3 — A hidden client keeps its scope's demand visible but runs no scoped work, unless the performance profile allows background work
- BG4 — One Mate socket holds at most 16 client leases, a new client beyond them replacing the oldest
- BG5 — Host power values marked stale gate no scoped work, however constrained they read
