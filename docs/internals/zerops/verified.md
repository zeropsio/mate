# Platform assumptions

Re-check these against the current Zerops API with a permitted account. `API` is the public REST
base URL, `TOKEN` its credential and `ORG` an accessible organization. Commands print shapes or
status codes, never credential values or variable contents. Assumptions already explained beside
the dependent code are not repeated here.

- **An organization search is filtered to the credential's permitted projects.**
  Dependency: `packages/client-runtime/src/data/demand.ts` (`zeropsRegistrations`) and
  `packages/client-runtime/src/data/adapters/zerops.ts` (organization listing registration).
  Re-check the same command with two existing credentials of different project coverage:

  ```sh
  curl -fsS -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"search\":[{\"name\":\"clientId\",\"operator\":\"eq\",\"value\":\"$ORG\"}],\"limit\":100}" \
    "$API/project/search" | jq '{ids:[.items[].id],totalHits,limit,offset}'
  ```

  This verifies the baseline's access filtering; it does not establish push revocation or replay.

- **A public HTTP routing search requires its organization filter.** Omitting `clientId` is rejected.
  Dependency: `packages/client-runtime/src/data/families/publicRouting.ts` (`organization`) and
  `packages/client-runtime/src/data/adapters/zerops.ts` (listing filter).

  ```sh
  curl -fsS -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"search\":[{\"name\":\"clientId\",\"operator\":\"eq\",\"value\":\"$ORG\"}],\"limit\":100}" \
    "$API/public-http-routing/search" | jq '{ids:[.items[].id],totalHits,limit,offset}'
  curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' -d '{"search":[],"limit":100}' \
    "$API/public-http-routing/search"
  ```

- **A public port routing search requires its organization filter too** (2026-10-14).
  Dependency: `packages/client-runtime/src/data/families/publicPortRouting.ts` (`organization`).
  The same pair of commands against `$API/public-port-routing/search`: the filtered one lists, the
  unfiltered one answers `invalidUserInputWithText`.

- **The shared IPv4 is no field of any row; a project's zone answers on it while
  `publicIpV4Shared` is on**, and only on the project's IPv6 while it is off (2026-10-14).
  Dependency: `packages/client-runtime/src/data/projections/addresses.ts` (`SHARED_IPV4`, `dnsAdvice`).
  For a project of each kind:

  ```sh
  curl -fsS -H "Authorization: Bearer $TOKEN" "$API/project/$PROJECT" | jq '{publicZone,publicIpV4Shared}'
  dig +short A "$ZONE"; dig +short AAAA "$ZONE"
  ```

- **Putting a project's routings in place puts every waiting change live, anybody's; with none
  waiting the platform refuses with `nothingToSync`**, domain and port routings alike
  (2026-10-14). Dependency:
  `packages/client-runtime/src/data/operations/executors/addressWrites.ts` (`putInPlace`). On a
  project whose routings all read `isSynced` (the commands change nothing there):

  ```sh
  for kind in http port; do curl -sS -X PUT -H "Authorization: Bearer $TOKEN" \
    "$API/project/$PROJECT/sync-public-$kind-routing" | jq '.error.code'; done
  ```

- **Billing lists each project's own IPv4 add-on with its state and price** (`metricId`
  `PROJECT_IPV4`, `userEnabled`, `unitPrice` per 30 days, `validTill`; 2026-10-14). Dependency:
  `packages/client-runtime/src/data/families/projectAddons.ts`.

  ```sh
  curl -fsS -H "Authorization: Bearer $TOKEN" "$API/billing/client/$ORG/available-addons" \
    | jq '[.projectAddons[] | {metricId,userEnabled,unitPrice}] | unique'
  ```

- **A Zerops access token lives 6 h, and `auth/refresh` revokes the previous one at once**
  (device-login and password sessions alike: `expiresIn` 21600 s; after a refresh the old access
  token answers 401, the spent refresh token 400; 2026-10-24). Dependency:
  `packages/client-runtime/src/zerops/data/zeropsSession.ts` (renewal margin under the lifetime).

  ```sh
  curl -fsS -X POST -H 'Content-Type: application/json' "$API/auth/refresh" \
    -d "{\"refreshTokenId\":\"$REFRESH\"}" | jq '{expiresIn}'
  curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN" "$API/user/info"
  ```
