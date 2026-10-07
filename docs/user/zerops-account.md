# Your Zerops account

Sign in with your Zerops account to use Mate. Before sign-in, Mate shows only the account entry.
Zerops handles your password, registration and second factor. There are no pairing codes or manual
server connections.

When your organization has no HQ, an organization owner or admin can choose **Set up HQ**
to create its Headquarters project in Zerops. Opening Mate does not start setup. Other members
are told whom to ask. Setup progress stays in
that project, so another admin's browser can continue it after a tab closes. If a step fails,
Mate shows why and stops. Fix the cause in Zerops, then press **Again**. If Zerops did not confirm
an operation, **Again** checks its recorded progress rather than sending the operation again.

HQ calls stop with a visible failure when HQ cannot answer. Press **Try again** to ask again.
If HQ's live connection drops, Mate keeps the last known projects visible and reconnects by
itself with increasing delays; only a refusal waits for **Try again** in the menu. Mate chats
remain available.

Opening a Mate reads its project before connecting. If that read cannot start, Mate shows the
reason and **Again**. Press **Again** to make one new attempt.

If a Zerops data stream drops, Mate reconnects automatically with increasing delays. The last
known data stays visible with **Reconnecting…**, its as-of time, and a warning that updates during
the interruption may be missing. **Try now** starts a fresh connection immediately. Reconnecting
reads a fresh baseline; it does not repeat operations. A refused session or permission ends the
connection visibly instead of reconnecting. Failed detail reads still need a manual check.

Mate lists projects your account can operate. Changes made elsewhere appear when the inventory
refreshes. A removed project or lost permission does not reopen from an old local list. If a
platform read fails, Mate shows a retry state instead of pretending your projects were deleted.
Production and stage rows show what Zerops reports running, across Overview, Projects, the app
flow, the detail page and the sidebar. A read that fails says why and offers **Again** for one
manual check. A saved release name alone does not mean production is healthy.
The projects page shows the version reported by each reachable Mate server. GUI and server versions
do not have to match. If a server is below the GUI's minimum supported version, Mate shows both
versions and **Restart and check for updates** before connecting. Confirming restarts
that project's zcp container and interrupts work running inside it. Mate then checks compatibility
and reconnects when the server is ready. The restart installs the release selected by zcp; it cannot
install an unreleased development build. If the version is still incompatible, Mate explains that
and offers a connection check instead of automatically restarting again.

**Restart** in a Mate's menu asks for confirmation. When Mate knows of running chats, the
confirmation names them and says restarting interrupts their turns. You can still restart.
While a confirmed restart prevents the conversation from opening, the Mate shows
its waking face and says it is restarting. An unavailable link says it is
reconnecting or unreachable instead; it does not claim a restart without evidence.
After boot, an interrupted chat names the completed Zerops restart, stop or deploy and who asked
for it when that information is available. A container replacement is identified when its start
time proves it happened during the turn; otherwise the chat gives Mate's restart time. Send a
message to continue. Mate keeps the coding agent's saved conversation cursor, but recovery depends
on that agent's saved session still being available.

The projects page cleans up expired temporary sign-in tokens left by an interrupted sign-in.
Cleanup progress and failures stay visible. Use **Clean up sign-in tokens** to find older
leftovers, or **Try again** after a cleanup failure. Reloading preserves a failed cleanup and
still requires **Try again**.

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

Creation progress and failures survive a reload of the same tab. A request interrupted before
Mate heard its answer is shown as uncertain; check the projects before starting again.

A Mate added from a recipe starts development after its asker signs an agent in. A Mate with no
recipe waits for you to say what to build. If the stand-up message fails to send, Mate says so and
offers **Try again** and gives you the composer back so you can type instead. It never sends another
attempt automatically.

If a provider sign-in says it could not be recorded, that attempt did not finish. Press **Try again**
to sign in again after the server can write its record. The login cannot start personal turns until
its signer is recorded.

Deleting a Mate also retires the Zerops key its container used. If HQ cannot identify that key,
the dialog shows the failure before deleting the project. If key retirement fails after the project
is deleted, the dialog says the Mate was deleted and keeps **Try again** for retiring that key only.

When you confirm deletion, this tab stops connecting to that Mate before sending the delete.
If the Zerops delete fails, its connection is restored. A later HQ or key-cleanup failure keeps
the connection stopped while you finish that step.

Deleting a Mate follows its Zerops deletion process, then asks HQ to release its records.
If HQ refuses or cannot answer, the dialog shows why and keeps **Try again** to finish that step.
It does not delete the Mate again. Its project shows **Deletion is still in progress.** until HQ
confirms completion. **Delete** for the empty project appears once HQ says it holds nothing.
If HQ's stream is unavailable, the confirmation waits for a current answer.

Signing out of a provider keeps the Mate's owner badge. It remembers the last person who signed
that provider in; the badge does not mean its provider account is still signed in. A later successful
sign-in updates that record.

A login check that cannot answer ends with **Couldn't verify** and its reason. In **Coding agents**,
press **Check again** to make one new check for that login. If the CLI signed you in but Zerops
registration failed, the row keeps the local sign-in and offers **Register again**. Registration
shows its accepted Zerops process and follows that process to its outcome; a failed read ends with
the handle and a reason. Inspect that process before registering again. These actions belong to
the member who signed the login in (or an operator when no signer was recorded). Mate never
repeats failed checks or registration writes automatically.

If HQ's live connection drops, Mate keeps the last projects shown with their as-of time and says
**Reconnecting…** while it reconnects automatically. If HQ remains unavailable, the notice says
it is retrying every 30 seconds and offers **Try again**. A session or permission refusal stops
automatic reconnects and shows the reason; **Try again** starts a new attempt. Reconnecting the
stream does not repeat your writes.

Move places a Mate within the same organization and HQ. Its container, conversations and repository history stay in place. Cross-organization, cross-HQ and physical container migration are unsupported. HQ explains destination refusals in the Move dialog; changing between a Mate and a deploy environment is refused until its credential and job migration can be completed.

If Move was accepted but Zerops still has its original name, **Finish renaming** completes that remainder. After a deleted Mate is gone, **Finish deleting Mate** on Projects completes its original HQ and exact-key cleanup. Reopening the account restores these actions from HQ; a lost answer does not start another Move or project deletion.
