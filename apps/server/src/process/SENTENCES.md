next: CH9

- CH1 — A child the server starts that would inherit the server's home resolves its home in the Mate's home, while a child handed a home of its own, or a full environment without one, keeps what its caller made
- CH2 — A Mate whose home is the server's own home spawns its children exactly as the platform does
- CH3 — Outside a Zerops project the server refuses to run a command as unavailable, and nothing is started
- CH4 — A command may run for at most 600 seconds: a longer deadline is refused before anything is started
- CH5 — A command's arguments reach the process as the list the caller gave, so shell metacharacters arrive as one opaque argument
- CH6 — A command with no working directory runs in the workspace root
- CH7 — A command runs under a 60-second deadline unless its caller names one, a passed deadline is a timed-out result, and each output stream is cut at 1 MiB rather than refused
- CH8 — A command that exits non-zero is a result carrying its exit code and error output, never an error, and one that cannot be started at all is refused as a spawn failure
