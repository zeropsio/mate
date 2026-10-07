import { describe, expect, it } from "vite-plus/test";
import { liveZerops, ORG } from "../__fixtures__/account.ts";
import { emptyAccount } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { mateRecovery } from "./mateRecovery.ts";
import { usageScope, usageOwnerOf } from "../families/usage.ts";

const key = { orgId: ORG, projectId: "p", serviceId: "s" };
const apply = (inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((state, input) => reduceAccount(state, input).state, emptyAccount);
const evidence = () =>
  liveZerops({
    projects: [{ id: "p", name: "Wren" }],
    services: [{ id: "s", projectId: "p", status: "ACTION_FAILED" }],
    running: [
      {
        id: "old",
        projectId: "p",
        serviceStackIds: ["s"],
        actionName: "stack.restart",
        status: "FAILED",
        created: "2026-10-07T10:00:00Z",
        failReason: "init failed",
      },
      {
        id: "other",
        projectId: "p",
        serviceStackIds: ["other-service"],
        actionName: "stack.restart",
        status: "FAILED",
        created: "2026-10-07T12:00:00Z",
      },
      {
        id: "new",
        projectId: "p",
        serviceStackIds: ["s"],
        actionName: "stack.start",
        status: "RUNNING",
        created: "2026-10-07T11:00:00Z",
      },
    ],
  });

describe("open Mate recovery projection", () => {
  it.each([0, 9, 10])(
    "reports full disk only from this container's measured limit (%s)",
    (used) => {
      const scope = usageScope(ORG, usageOwnerOf(ORG, "p"));
      const state = apply([
        ...evidence(),
        { kind: "stream", key: scope, now: 0, event: { kind: "demand", demanded: true } },
        { kind: "stream", key: scope, now: 0, event: { kind: "attempt" } },
        { kind: "baseline-begin", scope, generation: 1 },
        {
          kind: "baseline-commit",
          scope,
          generation: 1,
          via: "zerops-realtime",
          members: ["container"],
          rows: [
            {
              family: "usage",
              id: "container",
              value: {
                serviceId: "s",
                containerId: "container",
                cpu: null,
                vCpu: null,
                ramGBytes: null,
                diskGBytes: { used, limit: 10 },
              },
              revision: { kind: "zerops", version: null },
            },
          ],
        },
      ]);
      expect(mateRecovery.derive(readsOfState(state), key).diskFull).toBe(used === 10);
    },
  );
  it("uses the latest lifecycle attempt for this container, never another service's failure", () => {
    const read = mateRecovery.derive(readsOfState(apply(evidence())), key);
    expect(read.status).toBe("ACTION_FAILED");
    expect(read.process?.id).toBe("new");
  });
  it.each(["denied", "deleted"] as const)(
    "%s keeps identity but withholds process and resource details",
    (kind) => {
      const inputs: AccountInput[] = [
        ...evidence(),
        kind === "denied"
          ? { kind: "access", family: "project", id: "p", access: "denied" }
          : { kind: "proven-deletion", family: "project", id: "p", evidence: "projectNotFound" },
      ];
      expect(mateRecovery.derive(readsOfState(apply(inputs)), key)).toEqual({
        standing: { kind, name: "Wren" },
        status: undefined,
        process: undefined,
      });
    },
  );
  it("unknown container evidence stays unknown", () => {
    expect(mateRecovery.derive(readsOfState(emptyAccount), key)).toMatchObject({
      status: undefined,
      process: undefined,
      diskFull: false,
    });
  });
});
