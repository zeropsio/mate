import { describe, expect, it } from "vite-plus/test";
import { AtomRegistry } from "effect/reactivity";

import {
  liveZerops,
  ORG,
  processValue,
  serviceValue,
  zeropsVersion,
} from "./__fixtures__/account.ts";
import { runningScope } from "./families/process.ts";
import { servicesScope } from "./families/service.ts";
import { linkKeys } from "./model.ts";
import { HQ_BIRTH_UNFOLLOWED, hqBirthWaits } from "./hqBirthWaits.ts";
import { makeAccountStore } from "./store.ts";

function account() {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  liveZerops({
    running: [{ id: "deploy", projectId: "hq", status: "RUNNING" }],
    projects: [{ id: "hq" }],
    services: [
      { id: "s-db", projectId: "hq", name: "db", status: "CREATING" },
      { id: "s-vol", projectId: "hq", name: "vol" },
      { id: "s-hq", projectId: "hq", name: "hq" },
    ],
  }).forEach(store.dispatch);
  const held: string[] = [];
  const waits = hqBirthWaits({
    data: store.data,
    registry,
    demandDetail: (demand) => {
      held.push(demand.ownerId);
      return () => held.splice(held.indexOf(demand.ownerId), 1);
    },
  });
  return { store, waits, held };
}

describe("hqBirthWaits", () => {
  it("resolve as Zerops's facts arrive, holding HQ's project history meanwhile", async () => {
    const { store, waits, held } = account();
    const services = waits.untilServices(ORG, "hq");
    const deploy = waits.untilProcessEnds(ORG, "hq", "deploy");
    expect(held).toEqual(["hq", "hq"]);
    store.dispatch({
      kind: "rows",
      scope: runningScope(ORG),
      generation: 1,
      method: "push",
      via: "zerops-realtime",
      rows: [
        {
          family: "process",
          id: "deploy",
          value: processValue({ id: "deploy", projectId: "hq", status: "FINISHED" }),
          revision: zeropsVersion(2),
        },
      ],
    });
    await expect(deploy).resolves.toBe("FINISHED");
    store.dispatch({
      kind: "rows",
      scope: servicesScope(ORG),
      generation: 1,
      method: "push",
      via: "zerops-realtime",
      rows: [
        {
          family: "service",
          id: "s-db",
          value: serviceValue({ id: "s-db", projectId: "hq", name: "db" }),
          revision: zeropsVersion(2),
        },
      ],
    });
    await expect(services).resolves.toEqual({
      serviceId: "s-hq",
      serviceIds: { db: "s-db", vol: "s-vol", hq: "s-hq" },
    });
    expect(held).toEqual([]);
  });

  it.each(["services", "zone", "process"] as const)(
    "losing observation of %s leaves its outcome uncertain",
    async (step) => {
      const { store, waits, held } = account();
      const pending =
        step === "services"
          ? waits.untilServices(ORG, "hq")
          : step === "zone"
            ? waits.untilZone(ORG, "hq")
            : waits.untilProcessEnds(ORG, "hq", "deploy");
      store.dispatch({
        kind: "stream",
        key: linkKeys.zerops(ORG),
        now: 0,
        event: { kind: "demand", demanded: false },
      });
      await expect(pending).rejects.toMatchObject({
        message: HQ_BIRTH_UNFOLLOWED,
        kind: "uncertain",
      });
      expect(held).toEqual([]);
    },
  );

  it("keeps Zerops's reported import failure definitive", async () => {
    const { store, waits, held } = account();
    const pending = waits.untilServices(ORG, "hq");
    store.dispatch({
      kind: "rows",
      scope: runningScope(ORG),
      generation: 1,
      method: "push",
      via: "zerops-realtime",
      rows: [
        {
          family: "process",
          id: "deploy",
          value: processValue({ id: "deploy", projectId: "hq", status: "FAILED" }),
          revision: zeropsVersion(2),
        },
      ],
    });
    await expect(pending).rejects.toMatchObject({
      name: "Error",
      message:
        "HQ's service import is FAILED. Inspect process deploy in Zerops, fix the cause, then press Again.",
    });
    expect(held).toEqual([]);
  });
});
