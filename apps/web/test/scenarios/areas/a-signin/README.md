# Sign-in scenarios

This extension drives the production hosted client through account hand-over, organization
choices, reload, a second tab and the existing HQ retry button. Six green cases preserve
current behavior; two active expected failures cover automatic recovery after a session-query
outage and session expiry. Two logout cases are present but explicitly blocked (skipped).
Desktop/mobile are outside the shared hosted-web contract.

The second organization has read-only membership and no HQ. Switching shows the administrator
setup message and removes the first organization's work; returning restores its menu. This
does not prove switching between two working HQs: `startCore` needs a distinct `hqProjectId`
and `createScenario` needs multiple organization-scoped HQ origins for that fixture.

The session driver targets only disposable localhost Postgres. Expiry moves browser-session
deadlines into the past while preserving the fixture owner's session; its receipt is real
Core's 4401 stream close. The outage renames the session relation and waits for the disposable
database's `xact_rollback` to rise before restoring it in `finally`. Core is the only failing
query source in the scenario. No close code or unavailable banner is required during outage
setup, so a Core fix can keep the stream alive. This models a session-query failure rather
than a complete Postgres/role outage. No HQ response or stream frame is fabricated.

Today's client permanently stops live updates after both session-query failure and expiry.
Both `.fails` cases must reach their visible renamed-menu assertion. **Vitest 4.1.11 inverts
failures from `afterEach` too**: such a hook is not an independent setup/health guard. This
file uses `afterAll` to check every started expected-failure case reached its visible assertion,
and independently audits all retained browser errors and blocked requests. A `-t` filter does
not start excluded cases. The guard was proved by changing 4401 to 4999: the body was inverted
but the suite failed in `afterAll`. The outage recovery probe used a temporary Try again input;
the visible rename passed and `.fails` correctly reported an unexpected pass. Both restored.

Reload and second-tab cases count real `/authorize-app` requests. The original hand-over must
occur exactly once, and restoring the account/organization must not perform another hand-over.
On real Zerops each authorization mints a new personal token. Input mutations forced a fresh
hand-over on reload and in an isolated second context: both failed at count 2 versus 1 after
the correct screen appeared. An extra fake authorization count likewise failed selected-org
reload while its UI remained correct. The mutations were restored.

Logout does clear the account UI and stays signed out on reload, but also emits an uncaught
`Cannot access Atom … registry is disposed`. Tab B's logout reproduces loss of tab A's account
menu; it emits the same error in both pages. The current shared health hook rejects these errors.
With `.fails`, that rejection can conceal a future tab-isolation fix. Neither case can be safely
activated with its requested outcome under the unchanged shared hook; no diagnostics are hidden.
Exact shared request: add `web.expectPageErrors({ message, min, max })` to `harness/browser.ts`,
retaining raw diagnostics and permitting only explicit messages/counts after a visible assertion;
a non-inverted file-level `afterAll` must reject every unmatched error and blocked request.
These logout cases need this complete message with bounds `{ min: 0, max: 1 }` and
`{ min: 0, max: 2 }` respectively (zero permits a later application fix):

```text
Error: Cannot access Atom {
  "_id": "Atom",
  "keepAlive": true,
  "lazy": true,
  "label": undefined
}: registry is disposed
```

Alternatively fix application logout disposal. Also correct the shared README health claim to state that
`afterEach` is inverted by `.fails` and an independent `afterAll` health audit is required.
No shared harness or application file was edited.

Waits are condition/receipt deadlines with no elapsed-time performance assertions. UI and
Core-receipt deadlines allow 10 seconds versus the configured 200 ms recheck. Recovery advances
at most twelve 10-second browser steps, each followed by a bounded 1-second visible-rename attempt;
then the normal 10-second assertion. This gives network replies a native event-loop turn between
steps on a loaded machine. Core clocks remain native; there are no sleeps.
