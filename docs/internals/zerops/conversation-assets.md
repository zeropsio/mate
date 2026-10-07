# Conversation assets

Uploaded attachments already live under the server's persistent state directory. Images and
videos referenced by a conversation can also originate in disposable agent paths such as `/tmp`.
When the server first issues an asset URL for such a file, it streams the validated file descriptor
into `stateDir/assets`, beside `environment-id` and `mate-epoch`.

Media objects are keyed by their content digest and filename. A reference keyed by thread,
resource kind and original absolute path lets a reopened conversation mint a new URL. Once bound,
that reference always identifies the same retained content, even if the temporary source path is
reused. A new conversation capturing different bytes at that path gets a different content key.
Identical objects are reused. Workspace previews on persistent volumes keep their existing behavior.

Both the object and its reference publish by rename within the state filesystem, with the object
first. A failed or interrupted write cannot expose partial bytes or replace a reference with one
to an unpublished object. Scoped staging files are removed when the write exits. The existing
signed `/api/assets/<token>/<name>` route serves retained media, including video byte ranges;
URL expiration and signature checks still apply.

Before writing a retained copy, the server reserves ten percent of the state filesystem's total
capacity plus the incoming copy's size, using space available to its user. Under pressure it evicts
retained objects in least-recently-served order, checking actual free space after each removal.
Successful serves update the object's modification time; never-served objects use their capture
time. This order survives server restarts. SQLite, attachments and logs are never eviction targets.
If eviction cannot restore the reserve, the server declines the new copy.

Evicted objects return the existing missing-asset response, shown by the client as "Image unavailable".
Their small thread/path bindings remain so a reused source cannot replace missing historical media.
Existing signed references continue to work while their original files exist. Files already lost,
or removed before the server first retains them, cannot be recovered.
