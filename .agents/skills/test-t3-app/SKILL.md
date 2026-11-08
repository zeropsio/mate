---
name: test-t3-app
description: Launch, retain, and test the Mate web app in isolated development environments, including the Zerops sign-in door on the dev origin, worktree-safe state directories, cross-turn dev server lifecycle, and direct SQLite inspection or fixture seeding. Use when an agent needs to run Mate locally, iteratively test UI behavior with a human, sign a controlled browser in, isolate dev state, or prepare test data in state.sqlite.
---

# Test T3 App

Use this skill for the web client. For iOS Simulator, Android Emulator, or physical-device testing against an isolated T3 backend, use the sibling [`test-t3-mobile`](../test-t3-mobile/SKILL.md) skill.

## Start an isolated web environment

1. Run commands from the repository root.
2. Choose a base directory that belongs only to the current worktree or test:
   - Use the repository's ignored `.t3` directory for reusable worktree-local state.
   - Use `mktemp -d /tmp/t3code-test.XXXXXX` for disposable state and retain the printed absolute path.
3. Start the full web stack with `vp run dev`. In a linked worktree it defaults to that worktree's gitignored `.t3`; pass `--home-dir <base-dir>` only when the test needs a different isolated directory.
4. Keep the terminal session alive and read the selected server port, web port and base directory from its output.

Treat a base directory as disposable only when it was created or deliberately selected for the current test. Never delete or directly seed the shared `~/.t3` directory. Prefer starting with a new temporary base directory over clearing state of uncertain ownership.

The worktree-local default deliberately outranks an ambient `T3CODE_HOME`; do not pass the shared home through to a worktree dev server.

Ports are derived from the worktree path but can shift when occupied. Always read the actual values from the `[dev-runner]` line.

Shared browser dev is single-origin: Vite proxies the backend paths, so never set `VITE_HTTP_URL` or `VITE_WS_URL` for `dev`/`dev:web`.

The dev runner disables browser auto-open by default. Do not pass `--browser` during automated testing; drive the controlled browser instead.

### Verify a shared environment before human handoff

When another person will use the environment, open the printed web origin in the controlled browser and confirm the app loads. This browser navigation is required even when curl succeeds because browsers block some otherwise reachable ports before making a network request. Hand over the bare origin; the other person signs in with their own Zerops account.

## Preserve the environment while iterating

Treat the overall testing or implementation loop—not an assistant turn or one verification pass—as the environment lifecycle boundary.

- Keep the dev process, base directory, selected ports, authenticated browser tab, registered projects, and seeded fixtures alive while the user may inspect the result or request follow-up changes.
- Do not stop the server merely because one verification pass completed or because you are yielding a response to the user.
- Before starting another environment, check whether the existing process and browser tab still serve the task. Reuse them when healthy instead of discarding useful state.
- On a later turn, verify that the existing process is alive and reuse its printed ports and base directory. If it exited, restart with the same base directory; sign the browser in again only when its session is no longer valid.
- Tell the user when a test environment remains available, including its web origin when useful.

## Sign the browser in through the Zerops door

The dev server prints no credential: it names its origin and HQ. A browser signs in with a Zerops account, the same door as production.

1. Use the controlled in-app browser or browser-automation surface available to the agent, in a profile already signed in to `app.zerops.io`. Do not use a system-browser launch command during automated testing.
2. Open `<web origin>/zerops` and choose "Continue with your Zerops account". The tab goes to Zerops's consent page at `app.zerops.io/authorize-app`, which names the dev origin as the target; continue there.
3. Zerops mints a personal access token for the dev origin and returns to `<web origin>/zerops/authorized#token=<token>&state=<nonce>`. The app takes the fragment out of the URL and history on mount and adopts the token.
4. Continue in the same browser context so its stored session remains available.

The callback URL carries a live Zerops credential until the app removes it. Never print, log, screenshot or save the page URL, a navigation or request event, a HAR or a trace around the door: print `origin + pathname` only (strip `[?#].*`). A leaked one is revoked in the account's Settings › Token management (`Zerops Code · <device> · <origin>`).

## Inspect or seed SQLite state

Read [references/sqlite-fixtures.md](references/sqlite-fixtures.md) before changing the database.

- Use `node apps/server/scripts/t3-sqlite-state.ts query` for schema discovery and read-only checks.
- Stop the dev server before using `node apps/server/scripts/t3-sqlite-state.ts exec`, then restart it with the same base directory.
- Seed projection tables only for disposable UI fixtures. Use application commands and APIs when testing business behavior or projection correctness.
- Never edit `auth_*` tables directly; sign in through the door instead.

The helper refuses to write to the shared `~/.t3` directory by default and creates a database backup before each mutation.

## Tear down only when the testing loop is finished

Tear down when the user explicitly asks, confirms the iteration is finished, or the overall task is genuinely complete with no pending human review. Do not infer completion from the end of an assistant turn.

When teardown is appropriate:

1. Stop the dev process with its terminal interrupt.
2. Preserve the isolated base directory when it contains useful reproduction evidence or state for a likely follow-up.
3. Otherwise remove only a path created for this test after resolving and verifying the exact target.

If completion is uncertain, keep the environment alive and mention that it is retained for further iteration. A fresh isolated base directory remains the safest reset when authentication, migrations, or fixture state becomes ambiguous.

## Troubleshoot predictably

- If the browser lands on "Sign in to Mate" again, pass the door again; a Zerops password prompt means the profile's `app.zerops.io` session expired.
- If the UI shows unexpected data, verify that every command uses the identical explicit base directory before editing anything.
- If ports move because another instance is running, trust the current dev-runner output rather than assuming ports `13773` and `5733`.
