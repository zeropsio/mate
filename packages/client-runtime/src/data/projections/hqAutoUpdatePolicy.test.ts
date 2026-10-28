import { expect, it } from "vite-plus/test";
import { AtomRegistry } from "effect/reactivity";

import {
  autoUpdatePolicyRequestId,
  autoUpdatePolicyScope,
} from "../families/hqAutoUpdatePolicy.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { autoUpdatePolicySettings } from "./hqAutoUpdatePolicy.ts";

it("A person's auto-update choice shows as confirmed once HQ answers it, with no epoch on the wire.", () => {
  const store = makeAccountStore(AtomRegistry.make());
  const scope = autoUpdatePolicyScope("org");
  store.dispatch({
    kind: "rows",
    scope,
    generation: readsOfState(store.state()).stream(scope).generation,
    method: "read",
    via: "hq-stream",
    rows: [
      {
        family: "hqAutoUpdatePolicy",
        id: "org",
        value: { orgId: "org", enabled: false, revision: 1 },
        revision: { kind: "hq", incarnation: "hq", revision: 1 },
      },
    ],
  });
  const requestId = autoUpdatePolicyRequestId("org", 1);
  store.dispatch({
    kind: "operation-recorded",
    requestId,
    intent: { kind: "set-auto-update-policy", orgId: "org", enabled: true },
  });
  store.dispatch({
    kind: "operation-receipt",
    receipt: {
      requestId,
      operationId: "org",
      executor: "hq",
      affected: [],
      handles: [],
      acceptance: {
        kind: "accepted",
        result: { policy: { orgId: "org", enabled: true, revision: 2 } },
      },
      outcome: { kind: "succeeded", evidence: "HQ answered" },
    },
  });

  expect(
    autoUpdatePolicySettings.derive(readsOfState(store.state()), { orgId: "org", admin: true }),
  ).toMatchObject({
    policy: { kind: "known", enabled: true },
    pending: false,
    error: null,
  });
});
