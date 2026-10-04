# Your Zerops account

Sign in with your Zerops account to use Mate. Before sign-in, Mate shows only the account entry.
Zerops handles your password, registration and second factor. There are no pairing codes or manual
server connections.

When your organization has no HQ, an organization owner or admin's first visit starts it
as a Headquarters project in Zerops. Other members are told whom to ask. Setup progress stays in
that project, so another admin's browser can continue it after a tab closes. If a step fails,
Mate shows why and stops. Fix the cause in Zerops, then press **Again**. If Zerops did not confirm
an operation, **Again** checks its recorded progress rather than sending the operation again.

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

**Restart** in a Mate's menu asks for confirmation. When Mate knows of running chats, the
confirmation names them and says restarting interrupts their turns. You can still restart.
After boot, an interrupted chat names the completed Zerops restart, stop or deploy and who asked
for it when that information is available. A container replacement is identified when its start
time proves it happened during the turn; otherwise the chat gives Mate's restart time. Send a
message to continue. Mate keeps the coding agent's saved conversation cursor, but recovery depends
on that agent's saved session still being available.

Signing out locks every Mate tab sharing this browser login. It does not sign out other devices or
stop work already running in a project. Signing out of the Zerops website is separate from revoking
Mate's access; you can revoke Mate's token in Zerops account settings.
Mate also asks each connected server to revoke that browser session. If a server cannot be reached,
the browser still locks immediately and the remote session expires within its membership window
(normally 15 minutes).

When you sign in again, Mate checks current permissions and reconnects available remembered
projects. It restores your local view and unsent message when their target still exists. Tabs can
keep different organizations and different unsent drafts. A removed target's draft is never moved
to a different project or sent automatically.

Drafts and view preferences belong to this browser. Clearing site data removes them. Conversation
history and agent work belong to the container; the browser cache is not a backup.

If an operation's response is lost, inspect the project and its services before starting it again.
Mate reports uncertainty rather than assuming the operation failed or creating another project.

If a provider sign-in says it could not be recorded, that attempt did not finish. Press **Try again**
to sign in again after the server can write its record. The login cannot start personal turns until
its signer is recorded.

Deleting a Mate also retires the Zerops key its container used. If HQ cannot identify that key,
the dialog shows the failure before deleting the project. If key retirement fails after the project
is deleted, the dialog says the Mate was deleted and keeps **Try again** for retiring that key only.

Signing out of a provider keeps the Mate's owner badge. It remembers the last person who signed
that provider in; the badge does not mean its provider account is still signed in. A later successful
sign-in updates that record.
