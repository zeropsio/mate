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
import { expect, vi } from "vite-plus/test";

import type { HqStreamRequest } from "@t3tools/shared/hqStream";
import { AccountDataContext, type AccountData } from "../../zerops/accountData";
import { recordedReport, statistics } from "./usageTestFixtures";

vi.mock("../../env", () => ({ isElectron: false }));
vi.mock("../../hooks/useNavigateBack", () => ({ useEscapeToGoBack: () => {} }));
vi.mock("../../zerops/useNowMs", () => ({ useNowMs: () => 1_791_331_200_000 }));
vi.mock("../../zerops/ZeropsSessionProvider", () => ({
  useZeropsSessionOptional: () => ({
    user: { id: "dev" },
    activeOrganization: { id: "org", roleCode: "DEVELOPER" },
  }),
}));
vi.mock("../../zerops/useZeropsFeeds", () => ({ useEnvironmentProjectRef: () => null }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ Link: "a", useNavigate: () => vi.fn() }));
vi.mock("./usagePagePreferences", () => ({
  readUsagePagePreferences: () => ({ metric: "cost", windowDays: 7 }),
  saveUsagePagePreferences: () => {},
}));
vi.mock("../../zerops/useUsageEnvironmentIdentities", () => ({
  useUsageEnvironmentIdentities: () => ({
    identities: new Map(),
    people: new Map(),
    owners: "resolved",
    listed: true,
    baseline: "resolved",
    projects: new Map(),
  }),
}));
vi.mock("../../zerops/useTaskSourceSettings", () => ({
  useOrgTaskSource: () => ({
    read: { setting: { state: "unread" }, action: { kind: "idle" }, revealed: null },
  }),
  useAppTaskSource: () => ({
    read: { setting: { state: "unread" }, action: { kind: "idle" }, revealed: null },
  }),
}));
vi.mock("../ui/button", () => ({ Button: "button", InlineButton: "button" }));
vi.mock("../ui/scroll-area", () => ({ ScrollArea: "div" }));
vi.mock("../ui/select", () => ({
  Select: "div",
  SelectItem: "div",
  SelectPopup: "div",
  SelectTrigger: "div",
  SelectValue: "div",
}));
vi.mock("../ui/sidebar", () => ({ SidebarInset: "div" }));
vi.mock("../ui/toggle-group", () => ({ Toggle: "button", ToggleGroup: "div" }));
vi.mock("../ui/tooltip", () => ({ Tooltip: "div", TooltipPopup: "div", TooltipTrigger: "div" }));
vi.mock("../WorkspaceBreadcrumb", () => ({
  WorkspaceBreadcrumb: "div",
  WorkspaceBreadcrumbItem: "div",
  WorkspaceBreadcrumbSeparator: "span",
}));
vi.mock("../WorkspacePageContainer", () => ({ WorkspacePageContainer: "main" }));
vi.mock("../WorkspacePageHeader", () => ({ WorkspacePageHeader: "header" }));
vi.mock("./UsageProviderChart", () => ({ UsageProviderChart: "div" }));

import { UsagePage } from "./UsagePage";

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
    vi.stubGlobal("window", new EventTarget());
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
              JSON.stringify({ type: "scope-ready", scope, incarnation: "usage", revision: 1 }),
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
        withAccess: (frame) => Effect.succeed({ ...frame, accessToken: "person-access" }),
        open: () => Effect.succeed({ messages: Stream.fromQueue(messages), send }),
      },
    });
    const account: AccountData = {
      data: store.data,
      orgId: "org",
      demandDetail: observation.demandDetail,
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
        vi.unstubAllGlobals();
      }
    });
  }),
);
