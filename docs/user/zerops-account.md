# Your Zerops account

Sign in with your Zerops account to use Mate. Before sign-in, Mate shows only the account entry.
Zerops handles your password, registration and second factor. There are no pairing codes or manual
server connections.

Mate lists projects your account can operate. Changes made elsewhere appear when the inventory
refreshes. A removed project or lost permission does not reopen from an old local list. If a
platform read fails, Mate shows a retry state instead of pretending your projects were deleted.
The projects page shows the version reported by each reachable Mate server. GUI and server versions
do not have to match. If a server is below the GUI's minimum supported version, Mate shows both
versions and **Restart and check for updates** before connecting. Confirming restarts
that project's zcp container and interrupts work running inside it. Mate then checks compatibility
and reconnects when the server is ready. The restart installs the release selected by zcp; it cannot
install an unreleased development build. If the version is still incompatible, Mate explains that
and offers a connection check instead of automatically restarting again.

Signing out locks every Mate tab sharing this browser login. It does not sign out other devices or
stop work already running in a project. Signing out of the Zerops website is separate from revoking
Mate's access; you can revoke Mate's token in Zerops account settings.
On older supported servers, the browser locks immediately but its server session may remain valid
until the membership window expires (normally 15 minutes). Updated servers also support immediate
revocation of that session.

When you sign in again, Mate checks current permissions and reconnects available remembered
projects. It restores your local view and unsent message when their target still exists. Tabs can
keep different organizations and different unsent drafts. A removed target's draft is never moved
to a different project or sent automatically.

Drafts and view preferences belong to this browser. Clearing site data removes them. Conversation
history and agent work belong to the container; the browser cache is not a backup.

If an operation's response is lost, inspect the project and its services before starting it again.
Mate reports uncertainty rather than assuming the operation failed or creating another project.
