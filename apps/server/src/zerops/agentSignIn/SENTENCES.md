next: ZS12

- ZS1 — Claude's own status check counts as signed in only for a JSON object whose `loggedIn` is true and as signed out only for false; empty, unparsable, array or non-boolean output is unknown, and surrounding whitespace is ignored
- ZS2 — A Claude login check runs `claude auth status` once as an argument list, and one that timed out is unknown with a reason even when its output says signed in
- ZS3 — Marking an agent signed in creates its flag row when absent, leaves a readable row reading true, and replaces a row holding any other value or marked sensitive; another agent's row is never considered
- ZS4 — Signing an agent out deletes its signed-in row and its auth-type row only when that reads "oauth": a token's auth-type row stays
- ZS5 — The signed-in flag is written on the Mate's own service as a readable (non-sensitive) row reading true
- ZS6 — An agent authorized by the project's token cannot be signed out, and the refusal cancels, stops, logs out and clears nothing
- ZS7 — An agent's sign-out cancels its login, stops its sessions, runs its CLI logout, removes the credential file when the logout failed or left it, then invalidates the pending mark, clears the flag and rechecks, in that order, and a failing step never stops the next
- ZS8 — An API-key login is removed without a CLI but never signed out, an agent's own login cannot be removed, and an unknown login is refused
- ZS9 — A sign-out stops the sessions on each instance id the login is known by: an agent's default instance and its agent id, once when they are the same, and a further login's own id
- ZS10 — On Zerops the project's sign-in flag decides whether Claude Code or Codex can be picked: a signed-in agent is ready, keeping the driver's account details and a working agent's note, any other state cannot be picked and says why, and other drivers, an uninstalled driver and anything outside Zerops are left as the driver reports them
- ZS11 — A turn counts as failed for want of a login only when its error is Claude's own signed-out opening or Codex's unauthorized or 401 answer on that agent's own instance; a warning, another failure, a Git refusal or another driver's or custom instance's error does not
