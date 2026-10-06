# Sign-in scenarios

The area drives the actual hosted client through account hand-over, organization choices,
reload, a second tab, session recovery and logout. Eight green cases preserve current behavior;
two `.fails` cases name today's bugs. No scenario is skipped. Desktop/mobile are outside the
shared hosted-web contract.

The green expiry case waits for either the renamed row or the HQ Try again button. It clicks
only when the button was observed first, then requires the renamed row, one account hand-over
and no document reload. A healthy-session input probe delivers the rename with no retry button
and passes the same assertions. This keeps future automatic recovery compatible with the test.

The two automatic-recovery failures require reaching the visible renamed-menu assertion.
The session driver targets disposable localhost Postgres: expiry preserves the fixture owner's
session; outage renames the session relation until database rollbacks show Core attempted its
read, then restores it in `finally`. Outage setup requires no close code or outage banner.
This is a session-query failure, not a full database/role outage; no HQ response/frame is fabricated.

Logout clears the account UI and stays signed out on reload, with no `registry is disposed`
browser error. Tab B's logout leaves tab A signed in with its menu: a sign-out is its own tab's.
Their one/two known disposal errors are accounted for locally only after the target
assertion is reached and after a clean pre-logout browser-health check. The exact accepted message is:

```text
Error: Cannot access Atom {
  "_id": "Atom",
  "keepAlive": true,
  "lazy": true,
  "label": undefined
}: registry is disposed
```

The raw messages remain in `web.errors` and the area's diagnostic audit. Only these exact messages
are removed from the shared health list; `afterAll` rejects excess counts (one/two), while the
foundation's independent `afterAll` rejects every unmatched error and blocked request. Zero known
errors is allowed so fixing disposal does not introduce a new setup failure. In the tab-B case,
known disposal errors cannot substitute for tab A's account: the body asserts tab A's person and
menu row after the logout. The area retains its started/target guard
because setup errors must not masquerade as domain failures; filtered tests do not start it.
An injected uncaught browser error proved that unmatched diagnostics still fail the shared
`afterAll`, despite the logout body being an expected failure. A temporary Try again input also made the outage row assertion pass and `.fails` report an
unexpected pass, proving that settling does not conceal recovery. All probes were restored.
No shared harness or application file was edited, and no shared-file change is needed.

Reload/second-tab cases count `/authorize-app` requests; restoration must retain the single
original hand-over. On real Zerops each hand-over mints a new personal token. Existing input/fake
mutations proved that a second hand-over fails even when the restored screen is correct.

Normal account scenarios retain foundation's production-like 20/60/30-second Core cadence. Only
session-fault scenarios explicitly set native stream recheck to 1 second, allowing a 10-second
receipt deadline with tenfold headroom. They retain production ping/reconcile intervals. Browser
retries use shared `advanceStepped` with an HQ-only HTTP reply settler: the default all-HTTP
idle condition stalls on an unrelated account refresh while virtual time is paused. The settler observes real HQ response/abort receipts; the UI wait checks applied WebSocket
updates. At most twelve 10-second advances are each followed by a bounded
1-second visible-row attempt, then the normal 10-second assertion. There are no sleeps or elapsed
performance assertions; page clocks do not advance Core clocks.

The second organization has read-only membership and no HQ. Switching proves the admin setup
state removes the first organization's work and returning restores it. Switching between two
working HQs still needs `startCore` to accept a distinct `hqProjectId` and `createScenario` to
enroll multiple organization-scoped HQ origins. This is the remaining fixture fidelity gap.
