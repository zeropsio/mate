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
