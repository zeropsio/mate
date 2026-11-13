import { RegistryContext } from "@effect/atom-react";
import { it } from "@effect/vitest";
import { AGENT_USAGE_REPORT_PROTOCOL, type UsageReportQuery } from "@t3tools/contracts";
import {
  accountReadsAtom,
  agentUsage,
  agentUsageOwner,
  makeAccountStore,
  observeAccount,
  readsOfState,
} from "@t3tools/client-runtime/data";
import { AtomRegistry } from "effect/reactivity";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { act } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, vi } from "vite-plus/test";

import type { HqStreamRequest } from "@t3tools/shared/hqStream";
import { AccountDataContext, type AccountData } from "../../zerops/accountData";
import { recordedReport, statistics } from "./usageTestFixtures";
import * as navigateBack from "../../hooks/useNavigateBack";
import * as atomCommand from "../../state/use-atom-command";
import * as sessionContext from "../../zerops/sessionContext";
import * as feeds from "../../zerops/useZeropsFeeds";
import * as clock from "../../zerops/useNowMs";
import * as identities from "../../zerops/useUsageEnvironmentIdentities";
import * as taskSettings from "../../zerops/useTaskSourceSettings";
import * as preferences from "./usagePagePreferences";
import * as chart from "./UsageProviderChart";
import { stubUsageControls } from "./usagePage.test-fixture";

import { UsagePage } from "./UsagePage";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const words = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === "string" ? child : words(child))).join("");

function ScopedUsage({
  account,
  registry,
}: {
  readonly account: AccountData;
  readonly registry: AtomRegistry.AtomRegistry;
}) {
  return (
    <RegistryContext.Provider value={registry}>
      <AccountDataContext.Provider value={account}>
        <UsagePage scope={{ person: "owner" }} onScopeChange={() => {}} />
      </AccountDataContext.Provider>
    </RegistryContext.Provider>
  );
}

it.effect("A developer sees only their own Usage, even when a bookmark names another person", () =>
  Effect.gen(function* () {
    vi.stubGlobal(
      "window",
      Object.assign(new EventTarget(), { setTimeout, clearTimeout, setInterval, clearInterval }),
    );
    stubUsageControls();
    vi.spyOn(navigateBack, "useEscapeToGoBack").mockImplementation(() => {});
    vi.spyOn(clock, "useNowMs").mockReturnValue(1_791_331_200_000);
    vi.spyOn(sessionContext, "useZeropsSessionOptional").mockReturnValue({
      user: { id: "dev" },
      activeOrganization: { id: "org", roleCode: "DEVELOPER" },
    } as unknown as ReturnType<typeof sessionContext.useZeropsSessionOptional>);
    vi.spyOn(feeds, "useEnvironmentProjectRef").mockReturnValue(null);
    vi.spyOn(atomCommand, "useAtomCommand").mockReturnValue(vi.fn());
    vi.spyOn(preferences, "readUsagePagePreferences").mockReturnValue({
      metric: "cost",
      windowDays: 7,
    });
    vi.spyOn(preferences, "saveUsagePagePreferences").mockImplementation(() => {});
    vi.spyOn(identities, "useUsageEnvironmentIdentities").mockReturnValue({
      identities: new Map(),
      people: new Map(),
      owners: "resolved",
      listed: true,
      baseline: "resolved",
      projects: new Map(),
    } as unknown as ReturnType<typeof identities.useUsageEnvironmentIdentities>);
    const unreadTask = {
      read: { setting: { state: "unread" }, action: { kind: "idle" }, revealed: null },
    };
    vi.spyOn(taskSettings, "useOrgTaskSource").mockReturnValue(
      unreadTask as unknown as ReturnType<typeof taskSettings.useOrgTaskSource>,
    );
    vi.spyOn(taskSettings, "useAppTaskSource").mockReturnValue(
      unreadTask as unknown as ReturnType<typeof taskSettings.useAppTaskSource>,
    );
    vi.spyOn(chart, "UsageProviderChart").mockImplementation(() => <div />);
    const fetch = vi.fn(() => Promise.reject(new Error("Unexpected network request")));
    vi.stubGlobal("fetch", fetch);
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    const messages = yield* Queue.unbounded<string>();
    const requested: UsageReportQuery[] = [];
    const rows = [
      { name: "Ada", owner: "owner", app: "Shop", provider: "claude" },
      { name: "Bea", owner: "dev", app: "Lab", provider: "codex" },
    ] as const;
    const send = (request: HqStreamRequest) =>
      Effect.gen(function* () {
        if (request.type !== "subscribe") return;
        for (const entry of request.scopes) {
          const scope = "scope" in entry ? entry.scope : entry;
          if (scope.kind === "navigation") {
            yield* Queue.offer(
              messages,
              JSON.stringify({
                type: "scope-ready",
                scope,
                incarnation: "hq",
                revision: 1,
                core: { protocol: 1, agentUsage: AGENT_USAGE_REPORT_PROTOCOL },
              }),
            );
          } else if (scope.kind === "agentUsage") {
            const query = scope.query;
            requested.push(query);
            const selected = rows.filter(
              (row) => query.ownerUserId === null || query.ownerUserId === row.owner,
            );
            const count = selected.length;
            const report = recordedReport({
              query,
              provenance: query.provenance ?? "live-responses",
              totals: statistics(String(count * 1000), String(count)),
              pricing: {
                ...recordedReport().pricing,
                costUsdNanos: String(count * 1000000000),
                pricedModelEntries: String(count),
              },
              coverage: selected.map(({ name, owner, app }) => ({
                ...recordedReport().coverage[0]!,
                originId: name,
                mateId: name,
                label: name,
                appId: app,
                ownerUserId: owner,
              })),
              groups: selected.map(({ name, provider }) => ({
                key: name,
                provider,
                model: "recorded-model",
                period: (query.since ?? "2026-10-01").slice(0, 10),
                totals: statistics(),
                costUsdNanos: "1000000000",
              })),
            });
            yield* Queue.offer(
              messages,
              JSON.stringify({
                type: "scope-reset",
                scope,
                incarnation: "usage",
                revision: 1,
                values: [{ key: "report", value: report }],
                removals: [],
              }),
            );
            yield* Queue.offer(
              messages,
              JSON.stringify({
                type: "scope-ready",
                scope,
                incarnation: "usage",
                revision: 1,
                core: { protocol: 1, build: "test" },
              }),
            );
          }
        }
      });
    const observation = observeAccount({
      store,
      repairSession: Effect.void,
      wire: {
        open: Effect.succeed({
          receiverId: "receiver",
          frames: Stream.never,
          post: () => Effect.succeed({ items: [] }),
          get: () => Effect.succeed({ status: 404, body: null }),
        }),
      },
    });
    observation.show("org");
    observation.showHq({
      orgId: "org",
      wire: {
        open: () => Effect.succeed({ messages: Stream.fromQueue(messages), send }),
      },
    });
    const demandDetail = vi.fn(observation.demandDetail);
    const account: AccountData = {
      data: store.data,
      orgId: "org",
      demandDetail,
      renewHeld: observation.renewHeld,
      readDetail: observation.readDetail,
      revalidate: observation.revalidate,
      retryDetail: observation.retryDetail,
      retry: observation.retry,
      showHq: observation.showHq,
      moveOffers: observation.moveOffers,
      compare: observation.compare,
      logs: null,
    };
    registry.set(accountReadsAtom, account);
    const ready = new Promise<void>((resolve) => {
      const stop = store.subscribe(() => {
        if (
          requested.length >= 4 &&
          requested.every(
            (query) =>
              agentUsage.derive(readsOfState(store.state()), {
                orgId: "org",
                owner: agentUsageOwner(query),
              }).kind === "read",
          )
        ) {
          stop();
          resolve();
        }
      });
    });
    yield* Effect.promise(async () => {
      let tree: ReactTestRenderer | undefined;
      try {
        await act(async () => {
          tree = create(<ScopedUsage registry={registry} account={account} />);
        });
        expect(
          demandDetail.mock.calls.filter(([request]) => request.family === "agentUsage").length,
        ).toBeGreaterThanOrEqual(4);
        await act(async () => {
          await ready;
        });
        expect(fetch).not.toHaveBeenCalled();
        expect(requested.length).toBeGreaterThan(0);
        expect(requested.every((query) => query.ownerUserId === "dev")).toBe(true);
        expect(words(tree!.root)).toContain("1 turn");
        expect(
          tree!.root.findAll(
            (node) => typeof node.type === "string" && node.props["aria-label"] === "Usage person",
          ),
        ).toHaveLength(0);
        const breakdowns = tree!.root.findAll(
          (node) => typeof node.type === "string" && node.props["aria-label"] === "Usage breakdown",
        );
        expect(breakdowns.flatMap((node) => node.findAllByType("button")).map(words)).not.toContain(
          "Owner",
        );
      } finally {
        if (tree !== undefined) act(() => tree!.unmount());
        observation.stop();
        registry.dispose();
      }
    });
  }),
);
