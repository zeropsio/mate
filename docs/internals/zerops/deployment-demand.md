# Runtime deployment demand

HQ relates each production and stage to a Zerops project by id. The account inventory preserves
those refs even before the organization's search lists the projects. A ref is an identity, not a
service read or evidence that anything runs.

A drawn stop's summary demand (`account/stops.ts`) holds `project-inventory`: one initial
service list, service membership and updates, and the embedded active deployment. Drawn overview
cells, Projects card cells, sidebar chips and their public-address surfaces share one entry per
stop. A cell holds demand before an answer or a failure exists; observing inventory refs alone
never demands every stop. What builds and what each service's active version is come from the
account's store (`data/projections/stopWork.ts`): the organization's running work and its active app
versions are navigation families, observed whether or not any stop is opened, so a summary settles
a running version, a build and nothing deployed alike.

Opening stop detail upgrades the shared entry to `project-topology` and reads the project's
newest processes, whose builds name the versions a roll back activates by id alone. Its opened
services demand runtime variables, which name a version no build named; detail waits for them. A
version a stop runs that the organization's active versions do not hold is read by id
(`GET /app-version/{id}`); one the platform does not have fails the stop, "Its active version is
not listed". Closing the last
detail releases those facts while any summary keeps its service demand. Navigation needs only the
enabled/setup flags of zcp containers, so its variable demand names only their service ids. The account's access demand admits each demanded project. A
confirmed gone project leaves the inventory. HQ flow reads cannot hide a stop's runtime answer.
App and stop detail pages show runtime from known stop identities even while HQ changes and release
detail is unavailable.
Undemanded refs do not hold Refresh in a loading state. The last view releasing a stop ends its demand. There is no polling; a
key waiting for a data slot takes the next one that frees, and a full queue asks again on the retry ladder.

Overview, Projects, the app flow, production/stage detail and the sidebar read the same
`Shown<Deployment>`. While the platform is unread, the flow's own known version still stands,
including a known inability to tell what a service runs. A complete platform answer takes precedence
over the flow. A failed recheck is visible even when an older answer is held.
Again renews access when refused, renews the visible demand and asks the data runtime for one manual project refresh. A sidebar
chip with a failed runtime answer cannot inherit a remembered healthy label. While serving status
is unread, it keeps its remembered facts until a new answer arrives.

Public addresses have their own account-scoped `public-access` cell, keyed by the drawn stop's
project id. Sidebar chips, Overview/Projects menus and stop detail mount that cell independently of
the navigation candidate listing. One read obtains `/project/:id`, `/project/:id/service-stack` and
`/project/:id/public-http-routing`; the projection joins configured domain locations to services by
id and includes enabled HTTP subdomains. Concurrent surfaces share the same answer and demand.
An unread answer says reading; a failed answer offers Again and never claims there are no addresses.
A failed recheck retains its previous links with the failure. Publishing a subdomain invalidates the
cell once. Unmounting the last surface releases demand; there is no polling. A failed read retries on
the shared ladder while a surface holds it and the tab is visible; Again reads at once.

Desktop uses the same web surfaces. Mobile does not currently render these group-flow or stop-detail
surfaces; the shared runtime's demand and failure behavior applies to its consumers too. No wire
contract changes are needed.

Regression coverage lives in `account/stops.test.ts`, `data/projections/stopWork.test.ts`,
`flow/deployment.test.ts`, `groupFlow.test.ts` in client-runtime, and the web inventory lifecycle,
sidebar chip and `StopReadAgain` tests.
