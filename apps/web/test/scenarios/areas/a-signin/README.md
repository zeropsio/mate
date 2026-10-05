# Sign-in scenarios

This area installs its own extension before fixtures and drives the production client through
account hand-over, organization choices, browser reload and the existing HQ retry control.
It covers hosted web only; desktop/mobile are outside the shared suite contract.

The second organization deliberately has a read-only membership and no HQ. Switching shows
the admin setup message and removes the first organization's work; returning restores its menu.
This does not prove switching between two working HQs. That fixture needs `startCore` to accept
a distinct `hqProjectId` and `createScenario` to enroll multiple organization-scoped HQ origins.

The session driver targets only the scenario's disposable localhost database. Expiry moves
browser session deadlines into the past while preserving the fixture owner's session. The
outage temporarily makes the session relation unreadable, restores it in `finally`, and waits
for real Core's stream-close receipt. This is a session-query failure, not a full Postgres or
roles outage. No HQ HTTP response or stream frame is fabricated.

Today's HQ stream stops definitively on `4401`: after a transient database failure it shows
HQ unavailable and never receives the later rename. The expected-failure test requires reaching
that visible assertion; setup/injection failures also fail an independent `afterEach` guard.
An expired session has the same automatic-renewal gap. The green expiry test preserves the
working **Try again** recovery path, without account authorization or document reload.

Withheld cases: menu sign-out and tab B signing out tab A also produce an uncaught
`Cannot access Atom … registry is disposed`. The shared `harness/browser.ts` health hook rejects
that error outside `it.fails`, so these cannot currently run with the requested outcome.
Shared request: add an explicit expected-page-error assertion API to `openBrowser`, checked by
its independent health hook, allowing these cases to declare and assert this exact existing
error while still rejecting every unmatched error. Alternatively fix logout disposal before
adding the two cases. No shared hook or application code was changed here.

All waits are condition/receipt deadlines, with no elapsed-time performance assertions. UI and
session-close deadlines allow 10 seconds (Core's configured recheck is 200 ms). The outage case
advances browser retries by 120 seconds only after the refusal and database restoration; real
Core clocks remain native.
