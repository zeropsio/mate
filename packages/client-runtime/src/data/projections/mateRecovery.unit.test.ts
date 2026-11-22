import { AtomRegistry } from "effect/reactivity";
import { expect, it } from "vite-plus/test";
import { liveZerops, ORG } from "../__fixtures__/account.ts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { makeAccountStore } from "../store.ts";
import { mateRecovery } from "./mateRecovery.ts";

const key = { orgId: ORG, projectId: "p", serviceId: "s" };

// witness: packages/client-runtime/src/data/projections/mateRecovery.ts | const linked = hqMatePresence.derive(read, key)?.online === true; → const linked = false;
it("PJ112: A Mate HQ says is linked is never said to have failed because Zerops marks its service FAILED, and one with no link is offered its restart; breaks: a working Mate's page hides its conversation behind \"couldn't restart\" (2026-11-20, 16 Mates)", () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  liveZerops({
    projects: [{ id: "p" }],
    services: [{ id: "s", projectId: "p", status: "FAILED" }],
    running: [
      {
        id: "failed-restart",
        projectId: "p",
        serviceStackIds: ["s"],
        actionName: "stack.restart",
        status: "FAILED",
      },
    ],
  }).forEach(store.dispatch);
  const linked = (online: boolean) =>
    seedHqNavigation(store, ORG, {
      mates: { p: { presence: { online, since: "2026-11-20T20:04:30Z", overview: "none" } } },
    });
  const read = () => registry.get(store.data.project(mateRecovery, key));

  linked(true);
  expect(read().status).toBe("FAILED");
  expect(read().lifecycle).toBeUndefined();

  linked(false);
  expect(read().lifecycle?.state).toBe("failed");
  expect(read().lifecycle?.actions).toContain("restart");
  registry.dispose();
});
