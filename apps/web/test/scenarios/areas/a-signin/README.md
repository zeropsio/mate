# Sign-in scenarios

This area exercises hosted account hand-over, organization selection, reload, several tabs,
HQ session recovery and logout. All cases are ordinary behavioral assertions; the shared browser
health guard rejects every uncaught error and unmapped request, including registry disposal errors.

Automatic expiry recovery and explicit retry are separate paths. Expiry updates only disposable
localhost Postgres sessions and preserves the fixture owner's session. The explicit retry case
ends an existing HQ connection with a definitive refusal, requires pressing the visible Try again,
and proves navigation returns without another account hand-over or document reload. A session-read
outage temporarily renames the session relation and restores it after Core's read receipt.

Logout clears account content and stays signed out on reload. Signing out in a second tab locks
the first tab too; opening or closing a neighboring tab leaves other sessions independent. Background
tabs are brought to the front before visible assertions.

Normal cases use production-like Core cadence. Session fault cases set only the native session
recheck to one second. Browser retry timers use the controlled page clock and bounded HQ response
receipts; page clocks do not advance Core time.

The second organization is read-only and has no HQ. Switching removes the first organization's
work; returning restores it. Two functioning organization HQs remain outside this fixture.
