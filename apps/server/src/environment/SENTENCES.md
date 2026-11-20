next: EV6

- EV1 — The server advertises no SSH open target when no sshd accepts on either loopback, and the mDNS name when one accepts on IPv4 or IPv6 only
- EV2 — The server's environment descriptor carries the Zerops project id inside a Zerops container and no Zerops field outside one
- EV3 — The server counts as inside a Zerops container exactly when its launch carries a non-blank project id, which it keeps trimmed; an absent or blank id leaves it outside
- EV4 — Inside a Zerops container a thread may not run in its own worktree, use the stacked commit, push and pull-request action, or refresh its upstream automatically; outside one, or with no server config, all three are allowed
- EV5 — A container's start time is read from PID 1's start ticks over the host's boot time, and a stat line of any other process or an unreadable one gives no start time
