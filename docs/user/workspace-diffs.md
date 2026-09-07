# Reviewing changes across services

A conversation can change several services, such as an API and an app. After work finishes, its
changed-files card groups the recorded changes by service. Open the full diff or select a file;
each service loads independently and can be retried independently.

Mate compares snapshots of eligible working files from before and after the work, including
uncommitted changes. Existing staged changes and application commits are left alone. A follow-up
sent while the agent is still working belongs to that continuous work interval. Other people or
processes writing to the same files can also contribute to the observed difference.

The card distinguishes incomplete capture from no changes. A service first seen after edits has no
proven starting snapshot. Missing Git, unsupported content or capture limits can also restrict the
result. Older conversations did not record full service identities and are labeled accordingly.

Snapshots live in the service's Git repository. Disconnecting a service can temporarily prevent
loading; retry when it is reachable. A deployment that replaces its Git history may permanently
remove the required snapshots. The saved summary may remain even when the detailed diff is no
longer available. Available changes from other services still appear.

This review history is not a complete backup of runtime files. Automatic restore is unavailable for
these workspace snapshots; use the recorded diff to review and deliberately revert application
changes through your normal Git workflow.
