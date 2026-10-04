# Person Git access

The HQ replacement decision of 2026-10-02 retires Gitea as the product destination. It does not
remove a person's repository source access. HQ owns repositories; Zerops remains the authority for
membership and project roles. No Gitea account, broker token or mirrored group is added.

`GET /api/apps/:appId/repos/:repo/source` uses the person's HQ session and the existing
`read_change` permission before checking repository existence. Its query selects a branch or full
commit SHA, a repository-relative path and `tree` or `file`. Branches resolve once to a SHA; all
content in that response and subsequent navigation uses that commit. The git layer's read ceilings
apply, with a 256 KiB file ceiling. Binary files carry no text; clipped files and listings explicitly
carry `truncated`. Empty trees and unavailable reads stay distinct.

The client-runtime repository store holds source facts per account/HQ and full target identity,
using `Known` cells. Concurrent demand is shared. Reads have one attempt and manual recovery, with
no refresh timer. Up to 32 unleased facts are retained; mounted facts are never evicted. Account
close aborts reads and discards their results and cached content. A permission refusal withholds
previously retained content. The current client grant also withholds cached source synchronously;
unread grants expose no cached source. Git links use application ids and the hosted base path.

Web owns the source UI and its address at `/git`. Desktop uses the same web UI. Mobile retains no
account Git page in this fork; the source API and platform-free store are shared for its future
presentation. The released hosted web client is the product surface.

This restores source tree/file browsing. Issues, wiki, boards, packages and generic forge Actions
are outside this parity brief; HQ's changes, releases and deploys remain their current workflows.

## Person HTTPS credentials

`POST /api/apps/:appId/git-credentials` issues a random 256-bit password, separate from HQ client
sessions and Mate credentials. It is bound to the issuing person, organization and application id,
and expires after 12 hours. HQ keeps only its SHA-256 in `hq_git_credential`.

`GET` on that route returns only the holder's active credential metadata. `DELETE …/:id` revokes
only their own credential. Git uses Basic auth with username `person` and the password at
`/git/:appId/:repo.git`. Every request checks the organization, application scope and current
`read_change` permission for reads, or `push_repo` for pushes. Neither an HQ client session nor a
Git password can be used in the other's authentication door. Issue and revoke are leader-fenced
writes; credential responses are no-store.
A backup restore revokes all restored Git passwords; older backups without the table still restore.

The shared credential store owns metadata and each command's visible result. Concurrent presses
share one attempt. Failed reads and commands require manual recovery. Passwords remain in memory,
are dropped on panel close or capability loss, and cannot arrive after account close. Metadata
from an issue that lands before the first list has only partial coverage until a successful list.

## Person writes

`push_repo` uses main's app write-team rule: Basic user or above on any currently attached project,
with each project's explicit grant overriding the organization role. An active organization
owner retains main's site-admin Git rights, including an application without projects. An
organization admin without an app developer grant does not gain Git write access. Reads use the
same app source permission as the browser. Release rights remain the existing release workflow's.

Push authorization uses the same write-freshness policy as other HQ writes, and confirms a refusal
with fresh Zerops facts. Credentials carry identity and scope, never frozen role claims.
The Git layer receives an app-scoped person principal only after this check. Its built-in ref
policy permits topic branches; it refuses `main`, tags, the entire `mate` namespace and non-head
refs. Existing branch deletion and non-fast-forward protections still apply, even for owners.
Each Git command ends in Git's response, with a per-ref refusal for protected refs. A pushed topic
branch can be selected after a manual source read; no background refresh or retry is added.

## Change link publication

zcp opens a change through HQ, which returns its committed identity, then pushes its branch before
publishing the conversation link. Smart HTTP waits for HQ's ordered event receipt to record the
pushed head before returning success. A recording failure fails the request; Git's applied refs
stay in place for Core's existing reconciliation. Local Git operations keep nonblocking event
delivery so a recorder can call back into the Git layer. No client-provided link outcome can
replace the reader's current access check.

A conversation link or review reads a change missing from the flow once. The result appears at
once: read, not found (including an open change without a pushed head), refused or unavailable.
Only not found and unavailable offer **Read again**. A refusal, including 403, has no recovery
button. Web and desktop share this reader. Mobile has no counterpart to these standalone
conversation link and change-review surfaces; its shared project flow remains stream-driven.
