# Runtime deployment demand

HQ relates each production and stage to a Zerops project by id. The account inventory preserves
those refs even before the organization's search lists the projects. A ref is an identity, not a
service read or evidence that anything runs.

The shared deployment store's visible-stop demand holds `project-topology`: one initial
service-stack read, the service membership and updates, and running-process membership and updates.
It cannot depend on navigation holding a separate service lease. The account's access demand admits
the project; its opened-service demand follows active versions and variables for those service ids.
Visible production/stage chips and active detail scopes demand runtime; unrelated
navigation projects consume no detail receiver. Each mounted sidebar chip also holds its named ids,
including a remembered project the listing omits; account access publishes its ref before metadata
arrives. A confirmed gone project leaves the inventory. HQ flow reads cannot hide a stop's runtime answer. App and stop detail pages show runtime from known
stop identities even while HQ changes and release detail is unavailable.
Undemanded refs do not hold Refresh in a loading state. The last view releasing a stop ends its demand. There is no polling or automatic capacity retry.

Overview, Projects, the app flow, production/stage detail and the sidebar read the same
`Shown<Deployment>`. While the platform is unread, the flow's own known version still stands,
including a known inability to tell what a service runs. A complete platform answer takes precedence
over the flow. A failed recheck is visible even when an older answer is held.
Again renews access when refused, renews the visible demand and asks the data runtime for one manual project refresh. A sidebar
chip with a failed runtime answer cannot inherit a remembered healthy label. While serving status
is unread, it keeps its remembered facts until a new answer arrives.

Desktop uses the same web surfaces. Mobile does not currently render these group-flow or stop-detail
surfaces; the shared runtime's demand and failure behavior applies to its consumers too. No wire
contract changes are needed.

Regression coverage lives in `account/flow.test.ts`, `flow/deploymentStore.test.ts`,
`flow/deployment.test.ts`, `groupFlow.test.ts` in client-runtime, and the web inventory lifecycle,
sidebar chip and `StopReadAgain` tests.
