import { describe, expect, it } from "vite-plus/test";
import {
  makeZeropsApiOrigin,
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
  ZeropsServiceId,
  type ServiceRef,
} from "@t3tools/client-runtime/zerops/data";
import type { MateFlag } from "@t3tools/client-runtime/zerops/environments";

import { makeMobileContainers } from "./containers";

const service: ServiceRef = {
  kind: "service",
  project: {
    kind: "project",
    organization: {
      kind: "organization",
      account: {
        apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
        accountId: ZeropsAccountId.make("account-a"),
      },
      organizationId: ZeropsOrganizationId.make("org-a"),
    },
    projectId: ZeropsProjectId.make("project-a"),
  },
  serviceId: ZeropsServiceId.make("service-a"),
};

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("makeMobileContainers", () => {
  it("reads a container's Mate flag on the service its target names", async () => {
    const asked: Array<ServiceRef> = [];
    const containers = makeMobileContainers({
      clock: { now: () => ({ wall: 0, mono: 0 }), setTimer: () => () => undefined },
      probe: () => Promise.resolve({ kind: "predates-mate" }),
      readMateFlag: (target): Promise<MateFlag> => {
        asked.push(target);
        return Promise.resolve(false);
      },
      visibility: { current: () => true, subscribe: () => () => undefined },
    });

    containers.setTargets([
      {
        key: "project-a:service-a",
        origin: "https://zcp-demo.example.test",
        platform: { project: "ACTIVE", service: "ACTIVE" },
        service,
      },
    ]);
    await settle();

    expect(asked).toEqual([service]);
    expect(containers.store.verdict("project-a:service-a")).toEqual({ level: "needs-enable" });
    containers.dispose();
  });

  it("reads its containers again when the app comes back to the foreground", async () => {
    let probes = 0;
    const app: { foreground: ((visible: boolean) => void) | null } = { foreground: null };
    const containers = makeMobileContainers({
      clock: { now: () => ({ wall: 0, mono: 0 }), setTimer: () => () => undefined },
      probe: () => {
        probes += 1;
        return Promise.resolve({ kind: "predates-mate" });
      },
      // Off: the container needs Enable, and is read again only when something asks.
      readMateFlag: () => Promise.resolve(false),
      visibility: {
        current: () => true,
        subscribe: (listener) => {
          app.foreground = listener;
          return () => {
            app.foreground = null;
          };
        },
      },
    });
    containers.setTargets([
      {
        key: "project-a:service-a",
        origin: "https://zcp-demo.example.test",
        platform: { project: "ACTIVE", service: "ACTIVE" },
        service,
      },
    ]);
    await settle();
    const before = probes;

    app.foreground?.(false);
    app.foreground?.(true);
    await settle();

    expect(probes).toBe(before + 1);
    containers.dispose();
    expect(app.foreground).toBeNull();
  });
});
