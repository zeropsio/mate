# Platform assumptions

Re-check these against the current Zerops API with a permitted account. `API` is the public REST
base URL, `TOKEN` its credential and `ORG` an accessible organization. Commands print shapes or
status codes, never credential values or variable contents. Assumptions already explained beside
the dependent code are not repeated here.

- **An organization search is filtered to the credential's permitted projects.** The account
  adapter therefore registers the organization's families once rather than fetching each project.
  Dependency: `packages/client-runtime/src/data/demand.ts` (`zeropsRegistrations`) and
  `packages/client-runtime/src/data/adapters/zerops.ts` (organization listing registration).
  Re-check the same command with two existing credentials of different project coverage:

  ```sh
  curl -fsS -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"search\":[{\"name\":\"clientId\",\"operator\":\"eq\",\"value\":\"$ORG\"}],\"limit\":100}" \
    "$API/project/search" | jq '{ids:[.items[].id],totalHits,limit,offset}'
  ```

  This verifies the baseline's access filtering; it does not establish push revocation or replay.

- **A public HTTP routing search requires its organization filter.** The routing family's
  organization listing supplies `clientId`; omitting it is rejected.
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
