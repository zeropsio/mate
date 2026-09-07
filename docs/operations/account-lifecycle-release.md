# Account lifecycle release and recovery

The lifecycle change is contained in Mate. It preserves zcp's `serve` arguments, loopback binding,
base path, project/API/origin environment contract, readiness path and `zerops@mate` supervision.
Production zcp code and its Mate pin must not be changed as part of an unreviewed development push.

| Client       | Server                            | Result                                                                                                                     |
| ------------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Lifecycle v1 | Lifecycle v1                      | Zerops account entry, independent bounded sessions, own-session logout                                                     |
| Lifecycle v1 | Supported older server (>= 0.3.0) | Identity connection works; older server authorization and session-expiry rules remain                                      |
| Lifecycle v1 | Server below 0.3.0                | Upgrade required before identity exchange; actual and minimum versions shown                                               |
| Older client | Lifecycle v1                      | Manual cookie/pairing entry fails; identity-compatible clients still need the new client for full logout/restore semantics |

The minimum lives in `packages/client-runtime/src/zerops/serverCompatibility.ts`; it changes only
for a concrete mandatory protocol requirement, not every GUI release. The lifecycle capability is
informational. Supported old servers lack immediate own-session logout and the new effective-role
policy; do not report those guarantees until their server is upgraded. Before changing zcp's pin,
attach the exact Mate version,
artifact SHA-256, focused test results and disposable-container evidence to the maintainer's local
review record. The concrete pin change is version plus digest; do not manufacture a digest before
the final artifact exists. Obtain the production review before applying it.

No schema migration or destructive data conversion is introduced. Server rollback remains
connectable while the version is at or above the documented minimum. Restoring an older build also
restores its older access behavior, so it is not a way to
retain lifecycle guarantees. Keep a consistent database/secrets backup before operational recovery;
never feed a test snapshot back into a live install.

For local client development, run `vp run dev` in an isolated worktree and open the printed web
origin. Sign in through the Zerops handover (`localhost` supports the development callback). The
local server is not an independently pairable product. Server integration uses a disposable Zerops
container and an explicitly project-qualified dev-push target. Never point the dev server at
`~/.t3/userdata`, and never bake `VITE_HTTP_URL` or `VITE_WS_URL` into the bundle.

Historical local catalogs are ignored. There is no production migration or new deletion UI for
those development-only records. If cleanup is wanted, stop the owner of the explicitly identified
disposable installation, snapshot its state, and remove only that installation's files. Leave live
history and the maintainer's current processes alone.

The pre-connection upgrade recovery calls the platform service restart endpoint with the user's
account token and a service ID from the verified inventory; it does not need a working Mate session.
A container restart picks up the published zcp-selected release, not an unpublished worktree build.
The client checks the same minimum server version before reconnecting; a server below it is not success.
Lost restart responses are reported as uncertain and are never automatically resubmitted. This
recovery button does not replace the server-first publication/pin rollout described above.
