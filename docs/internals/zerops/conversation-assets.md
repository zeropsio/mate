# Conversation assets

Uploaded attachments already live under the server's persistent state directory. Images and
videos referenced by a conversation can also originate in disposable agent paths such as `/tmp`.
When the server first issues an asset URL for such a file, it streams the validated file descriptor
into `stateDir/assets`, beside `environment-id` and `mate-epoch`.

Media objects are keyed by their content digest and filename. A reference keyed by thread,
resource kind and original absolute path lets a reopened conversation mint a new URL after its
temporary source disappears. Identical objects are reused. Workspace previews on persistent
volumes keep their existing behavior.

Both the object and its reference publish by rename within the state filesystem, with the object
first. A failed or interrupted write cannot expose partial bytes or replace a reference with one
to an unpublished object. Scoped staging files are removed when the write exits. The existing
signed `/api/assets/<token>/<name>` route serves retained media, including video byte ranges;
URL expiration and signature checks still apply.

Existing signed references continue to work while their original files exist. Files already lost,
or removed before the server first retains them, cannot be recovered. There is no media retention
policy; retention must be designed with conversation deletion rather than inferred from URL expiry.
