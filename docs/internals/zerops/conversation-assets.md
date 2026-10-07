# Conversation assets

A Mate with `capabilities.contentAddressedImages` retains still-image bytes when a message, tool
result or upload is produced, before provider fitting and before the temporary source can disappear.
An occurrence records its conversation owner, digest, dimensions, name and capture result. Messages
and tool cards carry these references, rather than filesystem paths or inline image bodies. Reading
an older conversation backfills any bytes still available; bytes already lost cannot be recovered.

Originals live in the persistent Mate home under `userdata/assets`. SHA-256 identifies their exact
bytes. Atomic publication puts the object before its occurrence. Reusing a pathname in another
production creates another occurrence; it never changes a previous original. Ordinary server
restarts preserve these files. Container redeploys do not promise preservation: provisioning an
asset volume and migration remain separate work.

A drawn slot demands one lossless preview at its contained pixel size and display DPR, clamped to
the original. Concurrent equal demands share encoding. Nearby sufficient previews are reused.
Lossless WebP is chosen when supported and smaller than PNG. Opening the selected image reads its
original, retains the preview while loading, and offers an original download. Other gallery
originals are not prefetched.

The account data layer owns reads, Blob facts, receipts and retry policy. Mounted presentations own
Blob URLs and revoke them on release. No image facts enter browser storage. Transport outages keep
known facts; uncertain access withholds bytes; authoritative denial purges them. A definitive
refusal requires an explicit retry. The existing Mate authorization header protects the stable
`/api/assets/objects/<digest>/<original|preview>` route, resolved beneath the environment base path.
Session and owner checks run before GET, HEAD, validators and ranges. Responses use a strong digest
ETag and `Cache-Control: private, no-cache`; cached reloads revalidate with a bodyless 304.

Only an actual ENOSPC or SQLITE_FULL starts reclamation, and only regenerable previews may be
removed. Originals are never reclaimed, including objects without occurrence references. Preview
publication and cleanup exclude each other; a pressure retry preserves its in-flight representation.
There is no capacity accounting or disk-space reservation. The failed write is retried once; a still
failing write reports `Storage full`. A missing object is not described as expired, evicted or
intentionally deleted without evidence.

Older servers use their existing signed route, selected by the declared capability; modern reads
do not race a signed fallback. Native mobile reads modern originals through the same authorized
data adapter and presents an in-memory data URI; older servers retain the signed presentation.
Previously issued signed aliases cannot read content-addressed originals. Videos, non-image files and
external Markdown image URLs retain their existing behavior.
