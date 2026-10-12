import { describe, expect, it } from "vite-plus/test";

import { ORG } from "../__fixtures__/account.ts";
import { serviceVariableFamily, serviceVariablesScope } from "../families/serviceVariables.ts";
import { emptyAccount, type AccountState } from "../model.ts";
import { reduceAccount, type AccountInput, type Row } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { serviceVariableIds } from "./serviceVariableIds.ts";

const PROJECT = "p-chief";
const SCOPE = serviceVariablesScope(ORG, PROJECT);

const userData = (id: string, serviceStackId: string, key: string) => ({
  id,
  key,
  content: "REDACTED",
  type: "USER",
  editable: true,
  sensitive: true,
  created: "2026-10-12T10:00:00Z",
  lastUpdate: "2026-10-12T10:00:00Z",
  serviceStackId,
});

const event = (key: string, streamEvent: object): AccountInput =>
  ({ kind: "stream", key, now: 0, event: streamEvent }) as AccountInput;

/** The project's service variables answered once, decoded as the adapter decodes them. */
function answered(items: ReadonlyArray<unknown>): ReadonlyArray<AccountInput> {
  const rows = items.flatMap((item): Row[] => {
    const row = serviceVariableFamily.zeropsQuery!.decode(item);
    return row === null
      ? []
      : [
          {
            family: "serviceVariable",
            id: row.id,
            value: row.value,
            revision: { kind: "zerops", version: null },
          } as Row,
        ];
  });
  return [
    event(SCOPE, { kind: "demand", demanded: true }),
    event(SCOPE, { kind: "attempt" }),
    event(SCOPE, { kind: "handshake" }),
    { kind: "baseline-begin", scope: SCOPE, generation: 1 },
    {
      kind: "baseline-commit",
      scope: SCOPE,
      generation: 1,
      via: "zerops-realtime",
      members: rows.map((row) => row.id),
      rows,
    },
    event(SCOPE, { kind: "baseline-committed" }),
  ];
}

const idsOf = (inputs: ReadonlyArray<AccountInput>) => {
  const state = inputs.reduce<AccountState>(
    (current, input) => reduceAccount(current, input).state,
    emptyAccount,
  );
  return serviceVariableIds.derive(readsOfState(state), {
    orgId: ORG,
    projectId: PROJECT,
    serviceId: "s-zcp",
  });
};

describe("serviceVariableIds", () => {
  it("knows nothing until the project's service variables are read", () => {
    expect(idsOf([])).toBeNull();
  });

  it("names the Mate's own container's values by key, never another service's", () => {
    expect(
      idsOf(
        answered([
          userData("ud-1", "s-zcp", "ZCP_ORG_TOKEN"),
          userData("ud-2", "s-app", "ZCP_ORG_API"),
        ]),
      ),
    ).toEqual({ ZCP_ORG_TOKEN: "ud-1" });
  });

  it("names none where the service holds no values", () => {
    expect(idsOf(answered([]))).toEqual({});
  });
});
