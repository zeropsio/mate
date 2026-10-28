/**
 * A Mate's addresses as a conversation reads them: the project's topology and the conversation's
 * lifecycle, whose last envelope keys a part migrated to a dev pool by the pool.
 */
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { createContext, createElement, useLayoutEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { useMateAddresses, type MateAddressesRead } from "./useMateAddresses";

const STAGE_URL = "https://appstage-1df2-3000.prg1.zerops.app";

const mate = vi.hoisted(() => ({ lifecycle: undefined as unknown }));

vi.mock("./useZeropsFeeds", () => ({
  useZeropsTopology: () => ({
    services: [
      {
        hostname: "apppool",
        group: "infrastructure",
        type: "swarm@1",
        routes: [{ url: "https://apppool-1df2-3000.prg1.zerops.app" }],
      },
      {
        hostname: "appstage",
        group: "runtimes",
        type: "bun@1.3",
        routes: [{ url: "https://appstage-1df2-3000.prg1.zerops.app" }],
      },
    ],
  }),
  useZeropsLifecycle: () => mate.lifecycle,
  useEnvironmentProjectRef: () => null,
}));
vi.mock("../state/entities", () => ({ useThreadShell: () => null }));
vi.mock("./inventoryContext", () => ({ InventoryContext: createContext(null) }));
vi.mock("./ZeropsAccountData", () => ({ useProjectsServiceValues: () => ({}) }));

const mounted: ReactTestRenderer[] = [];
let read: MateAddressesRead;
function Probe() {
  const hook = useMateAddresses("env-mate" as EnvironmentId, "thread-1" as ThreadId);
  useLayoutEffect(() => {
    read = hook;
  }, [hook]);
  return null;
}

const render = () =>
  act(() => {
    mounted.push(create(createElement(Probe)));
  });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mate.lifecycle = undefined;
});
afterEach(() => {
  for (const tree of mounted.splice(0)) act(() => tree.unmount());
  vi.unstubAllGlobals();
});

const roles = () => read.addresses.map(({ service, role, url }) => ({ service, role, url }));

it("a part migrated to a dev pool: its stage is the Mate's preview once the conversation's last envelope pairs it with the pool", () => {
  mate.lifecycle = {
    state: "known",
    value: {
      threadId: "thread-1",
      recentTools: [],
      envelope: {
        services: [
          {
            hostname: "apppool",
            typeVersion: "swarm@1",
            runtimeClass: "pool",
            stages: [{ hostname: "appstage", setup: "prod" }],
          },
        ],
      },
    },
  };
  render();
  expect(roles()).toEqual([{ service: "appstage", role: "preview", url: STAGE_URL }]);
});

it("a conversation that carries no envelope yet pairs a migrated part's stage with the pool of its stem", () => {
  mate.lifecycle = { state: "unread", waitingFor: null };
  render();
  expect(roles()).toEqual([{ service: "appstage", role: "preview", url: STAGE_URL }]);
});

// The menu draws no Sites for a Mate in no project: its conversation's header lists these.
it("an ungrouped Mate's conversation still shows its previews, each by its part's name", () => {
  const url = "https://embedderpool-c2e4-8101.prg1.zerops.app";
  mate.lifecycle = {
    state: "known",
    value: {
      threadId: "thread-1",
      recentTools: [],
      envelope: {
        services: [],
        leases: [
          {
            alias: "embedderpool-3",
            pool: "embedderpool",
            branch: "feat-x",
            state: "held",
            devServers: [
              { name: "web", port: 8101, url, status: "running", readAt: "2026-10-25T09:00:00Z" },
            ],
          },
        ],
      },
    },
  };
  render();
  expect(
    read.addresses
      .filter((address) => address.url === url)
      .map(({ name, host }) => ({ name, host })),
  ).toEqual([{ name: "Embedder", host: "embedderpool-c2e4-8101.prg1.zerops.app" }]);
});
