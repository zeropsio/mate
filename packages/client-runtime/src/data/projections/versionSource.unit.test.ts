import { expect, it } from "vite-plus/test";

import { liveZerops, ORG } from "../__fixtures__/account.ts";
import { versionScope } from "../families/version.ts";
import { emptyAccount, type AccountState } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { versionSource } from "./versionSource.ts";

const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((current, input) => reduceAccount(current, input).state, state);
const event = (key: string, streamEvent: object): AccountInput =>
  ({ kind: "stream", key, now: 0, event: streamEvent }) as AccountInput;

// witness: packages/client-runtime/src/data/projections/versionSource.ts | if (read.stream(byId).phase === "refused") return { kind: "not-listed" }; → if (read.stream(byId).phase === "refused") return { kind: "awaited" };
it("PJ23: A version whose read by id the platform refuses is said not listed, never still awaited", () => {
  const scope = versionScope(ORG, "v2");
  const gone = apply(
    apply(emptyAccount, liveZerops({ running: [], active: [{ id: "v1", serviceId: "s1" }] })),
    [
      event(scope, { kind: "demand", demanded: true }),
      event(scope, { kind: "attempt" }),
      event(scope, {
        kind: "fault",
        jitter: 0,
        fault: { outcome: "definitive-refusal", message: "HTTP 400" },
      }),
    ],
  );
  expect(versionSource.derive(readsOfState(gone), { orgId: ORG, versionId: "v2" })).toEqual({
    kind: "not-listed",
  });
});
