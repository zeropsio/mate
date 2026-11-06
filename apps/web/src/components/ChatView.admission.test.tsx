// @vitest-environment happy-dom
import { RegistryContext } from "@effect/atom-react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import {
  accountReadsAtom,
  changeReadOwner,
  changeReadId,
  changeMetadataScope,
  engineThread,
  engineConversationLink,
  engineFactId,
  engineRowsScope,
  makeMateEngineConversations,
  streamOf,
  inventoryContents,
  makeMateFeeds,
  makeMateEngineOperations,
  type EngineCommand,
  mateEngineHostAtom,
  mateConversationStoreAtom,
  mateFeedReadsAtom,
  mateFeedAtom,
} from "@t3tools/client-runtime/data";
import {
  CommandId,
  ConversationHeader,
  DEFAULT_SERVER_SETTINGS,
  RunId,
  ServerProvider,
  type ServerConfig,
} from "@t3tools/contracts";
import {
  engineRow,
  membershipInputs,
  engineRun,
  noteItem,
  personItem,
  seedHqNavigation,
} from "@t3tools/client-runtime/data/fixtures";
import type { EnvironmentRegistry as EnvironmentRegistryType } from "@t3tools/client-runtime/connection";
import type { ZeropsAgentAuthSnapshot } from "@t3tools/contracts";
import { HqChange } from "@t3tools/shared/hqChanges";
import * as Queue from "effect/Queue";
import { mountRoster } from "@t3tools/client-runtime/zerops/testing";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Option from "effect/Option";
import * as Effect from "effect/Effect";
import type { EngineCallResult, EngineConversationFrame, EngineCursor } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import type { StreamFault } from "@t3tools/client-runtime/data";
import { useComposerDraftStore } from "../composerDraftStore";
import { openAccountLifetime, closeAccountLifetime } from "../zerops/accountLifetime";
import { act, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { it } from "@effect/vitest";
import { describe, expect, vi } from "vite-plus/test";

import { serverEnvironment } from "../state/server";
import { zeropsSessionAtom } from "../state/zerops";
import { organization, project, scope } from "../zerops/__fixtures__/platformData";
import { AgentAdmissionComposition } from "../zerops/AgentAdmissionComposition";
import { ZeropsReviewProvider } from "../zerops/ZeropsReviewProvider";
import { showProjectParts } from "../zerops/projectPartsShown";
import { environmentThreadDetails, environmentThreadShells } from "../state/threads";
import { AccountDataContext, AccountStoreContext, type AccountData } from "../zerops/accountData";
import { accountOperations, AccountOperationsContext } from "../zerops/accountOperations";
import { InventoryContext } from "../zerops/inventoryContext";
import { ZeropsSessionContext } from "../zerops/sessionContext";
import { ZeropsDataContext, type ZeropsDataContextValue } from "../zerops/zeropsDataContext";
import type { ZeropsSessionValue } from "../zerops/ZeropsSessionProvider";
import ChatView from "./ChatView";
import Sidebar from "./Sidebar";
import { SidebarProvider } from "./ui/sidebar";
import { SidebarAccountMenuProvider } from "./zerops/SidebarZeropsAccount";
import { cardAccount, CARD_KEY, CARD_RECORDS, CARD_THREAD } from "./chat/engineCard.test-fixtures";

// Only the virtual list's layout is supplied: its real rows and their renderers still run.
vi.mock("@legendapp/list/react", async () => {
  const React = await import("react");
  type Row = { id: string } | string;
  type Props = {
    data: Row[];
    renderItem: (input: { item: Row; index: number }) => React.ReactNode;
    keyExtractor: (item: Row) => string;
    onLoad?: (event: { elapsedTimeInMs: number }) => void;
    ListHeaderComponent?: React.ReactNode;
    ListFooterComponent?: React.ReactNode;
    ref?: React.Ref<unknown>;
  };
  function LegendList({ ref: listRef, ...props }: Props) {
    const element = React.useRef<HTMLDivElement>(null);
    React.useImperativeHandle(listRef, () => ({
      getScrollableNode: () => element.current,
      getState: () => ({
        data: props.data,
        sizes: new Map(),
        isWithinMaintainScrollAtEndThreshold: true,
        indexByKey: (key: string) => props.data.findIndex((row) => props.keyExtractor(row) === key),
        listen: () => () => {},
        elementAtIndex: (index: number) => element.current?.children.item(index) ?? undefined,
      }),
      scrollToEnd: () => Promise.resolve(),
      scrollToIndex: () => Promise.resolve(),
    }));
    React.useLayoutEffect(() => {
      props.onLoad?.({ elapsedTimeInMs: 0 });
    }, []);
    return (
      <div ref={element}>
        {props.ListHeaderComponent}
        {props.data.map((item, index) => (
          <div key={props.keyExtractor(item)}>{props.renderItem({ item, index })}</div>
        ))}
        {props.ListFooterComponent}
      </div>
    );
  }
  return { LegendList };
});

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => () => {},
  useParams: ({ select }: { select?: (params: Record<string, string>) => unknown }) =>
    select === undefined ? {} : select({}),
  useLocation: ({ select }: { select?: (location: { pathname: string }) => unknown } = {}) =>
    select === undefined ? { pathname: "/" } : select({ pathname: "/" }),
  useMatch: () => undefined,
  useSearch: ({ select }: { select?: (search: Record<string, string>) => unknown } = {}) =>
    select === undefined ? {} : select({}),
  useRouteContext: () => ({ status: "authenticated" }),
  useRouter: () => ({ state: { matches: [], location: { pathname: "/" } } }),
  useRouterState: () => ({ location: { pathname: "/" }, matches: [] }),
}));

// Supply the sidebar's shell at its transport boundary from the real engine-row projection.
vi.mock("../state/shell", async (original) => {
  const actual = await original<typeof import("../state/shell")>();
  const { engineRows, mateEngineHostAtom, overlayEngineShell } =
    await import("@t3tools/client-runtime/data");
  const { engineHeldTurns } = await import("@t3tools/client-runtime/data/fixtures");
  const { Atom } = await import("effect/reactivity");
  const Option = await import("effect/Option");
  const key = { environmentId: "env-card", conversationId: "thread-card" };
  const source = {
    status: "live" as const,
    error: Option.none(),
    snapshot: Option.some({
      snapshotSequence: 1,
      updatedAt: "2026-10-07T00:00:00Z",
      threads: [],
      projects: [
        {
          id: "env-card" as never,
          title: "Ada",
          workspaceRoot: "/workspace",
          repositoryIdentity: null,
          defaultModelSelection: null,
          scripts: [],
          createdAt: "2026-10-07T00:00:00Z",
          updatedAt: "2026-10-07T00:00:00Z",
        },
      ],
    }),
  };
  const snapshot = Atom.make((get) => {
    const host = get(mateEngineHostAtom);
    const rows = host === null ? [] : get(host.store.data.project(engineRows, key.environmentId));
    const held =
      host === null ? {} : get(host.store.data.project(engineHeldTurns, key.environmentId));
    return Option.getOrThrow(overlayEngineShell(source, rows, held).snapshot);
  });
  return { ...actual, environmentSnapshotAtom: Atom.family(() => snapshot) };
});

vi.mock("../state/threads", async (original) => {
  const actual = await original<typeof import("../state/threads")>();
  const { createThreadEnvironmentAtoms } = await import("@t3tools/client-runtime/state/threads");
  const { EnvironmentRegistry, EnvironmentSupervisor } =
    await import("@t3tools/client-runtime/connection");
  const Crypto = await import("effect/Crypto");
  const Effect = await import("effect/Effect");
  const Layer = await import("effect/Layer");
  const Option = await import("effect/Option");
  const SubscriptionRef = await import("effect/SubscriptionRef");
  const { Atom } = await import("effect/reactivity");
  const runtime = Atom.runtime(
    Layer.mergeAll(
      Layer.effect(
        EnvironmentRegistry,
        Effect.gen(function* () {
          const prepared = yield* SubscriptionRef.make(Option.some({ mateEngine: 1 }));
          return {
            run: (_id, effect) =>
              effect.pipe(
                Effect.provideService(EnvironmentSupervisor, {
                  target: { environmentId: _id },
                  prepared,
                } as never),
              ),
          } as EnvironmentRegistryType["Service"];
        }),
      ),
      Layer.succeed(
        Crypto.Crypto,
        Crypto.make({
          randomBytes: (size) => new Uint8Array(size),
          digest: (_algorithm, data) => Effect.succeed(data),
        }),
      ),
    ),
  );
  const { serverEnvironment } = await import("../state/server");
  const { environmentSnapshotAtom } = await import("../state/shell");
  const { environmentCatalog } = await import("../connection/catalog");
  const { createEnvironmentThreadShellAtoms } =
    await import("@t3tools/client-runtime/state/threads");
  const threadEnvironment = createThreadEnvironmentAtoms(runtime, environmentSnapshotAtom, {
    providersAtom: serverEnvironment.providersValueAtom,
  });
  return {
    ...actual,
    threadEnvironment,
    environmentThreadShells: createEnvironmentThreadShellAtoms({
      catalogValueAtom: environmentCatalog.catalogValueAtom,
      snapshotAtom: threadEnvironment.snapshotAtom,
    }),
  };
});

// The registry's transport is connected; presentation and the config feed remain the real ones.
vi.mock("../connection/catalog", async (original) => {
  const actual = await original<typeof import("../connection/catalog")>();
  const { PrimaryConnectionTarget, AVAILABLE_CONNECTION_STATE } =
    await import("@t3tools/client-runtime/connection");
  const { EnvironmentId } = await import("@t3tools/contracts");
  const { Atom, AsyncResult } = await import("effect/reactivity");
  const Option = await import("effect/Option");
  const environmentId = EnvironmentId.make("env-card");
  const catalogValueAtom = Atom.make({
    isReady: true,
    entries: new Map([
      [
        environmentId,
        {
          target: new PrimaryConnectionTarget({
            environmentId,
            label: "Card",
            httpBaseUrl: "https://example.test",
            wsBaseUrl: "wss://example.test",
          }),
          profile: Option.none(),
        },
      ],
    ]),
  });
  const state = Atom.make(
    AsyncResult.success({
      ...AVAILABLE_CONNECTION_STATE,
      phase: "connected" as const,
      desired: true,
    }),
  );
  return {
    environmentCatalog: { ...actual.environmentCatalog, catalogValueAtom, stateAtom: () => state },
  };
});

const decodeProvider = Schema.decodeUnknownSync(ServerProvider);
const decodeChange = Schema.decodeUnknownSync(HqChange);
const decodeHeader = Schema.decodeUnknownSync(ConversationHeader);
const recoveryHeader = (run: string, active: boolean) =>
  decodeHeader({
    conversationId: CARD_KEY.conversationId,
    agent: {
      instanceId: "claudeAgent",
      driver: "claudeAgent",
      model: "claude-sonnet-4-5",
      profile: { kind: "mate" },
    },
    archived: false,
    runStatus: active ? "running" : "ready",
    activeRunId: active ? run : null,
    latestRunId: run,
    model: "claude-sonnet-4-5",
    session: null,
    pausedUntil: null,
    queued: 0,
  });

let nextFrame = 0;

const admissionScenario = (
  kind: "one-voice" | "refused" | "sidebar" | "recovery" | "review",
  actor: "owner" | "colleague" = "owner",
) =>
  Effect.gen(function* () {
    const authEvents = yield* Queue.unbounded<{
      readonly kind: "value";
      readonly value: ZeropsAgentAuthSnapshot;
    }>();
    yield* Effect.promise(async () => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      const external = vi.fn(() => Promise.reject(new Error("Unexpected external request")));
      vi.stubGlobal("fetch", external);
      const sockets = vi.fn(() => {
        throw new Error("Unexpected WebSocket");
      });
      vi.stubGlobal("WebSocket", sockets);
      vi.stubGlobal("matchMedia", () => ({
        matches: false,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent: () => false,
        media: "",
        onchange: null,
      }));

      const frames = new Map<number, FrameRequestCallback>();
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
        frames.set(++nextFrame, callback);
        return nextFrame;
      });
      vi.stubGlobal("cancelAnimationFrame", (id: number) => {
        frames.delete(id);
      });
      const settleFrames = async () => {
        for (let i = 0; i < 12; i += 1) {
          await act(async () => {
            const ready = [...frames.values()];
            frames.clear();
            ready.forEach((frame) => frame(0));
          });
        }
      };
      try {
        openAccountLifetime(actor);
        if (kind === "review") showProjectParts([]);
        for (const version of ["0.16.0"]) {
          const projectId =
            kind === "sidebar" || kind === "review" || kind === "one-voice" ? "Ada" : "project-1";
          const account = cardAccount(vi.fn());
          const host = account.registry.get(mateEngineHostAtom)!;
          const calls: EngineCommand[] = [];
          let receivedCall = () => {};
          const called = new Promise<void>((resolve) => {
            receivedCall = resolve;
          });
          const opens: Array<{
            after: EngineCursor | null;
            frames: Queue.Queue<EngineConversationFrame, StreamFault | Cause.Done>;
          }> = [];
          let opened = () => {};
          let access: ((fault: StreamFault | null) => void) | undefined;
          const unexpected: string[] = [];
          const unexpectedRead = (name: string) => {
            unexpected.push(name);
            return Effect.fail({ outcome: "transient" as const, message: `Unexpected ${name}` });
          };
          const conversations =
            kind === "recovery"
              ? makeMateEngineConversations({
                  store: account.store,
                  live: account.live,
                  setTimer: (callback) => callback,
                  clearTimer: () => {},
                  wire: {
                    subscribe: (_key, after) =>
                      Stream.unwrap(
                        Effect.gen(function* () {
                          const frames = yield* Queue.unbounded<
                            EngineConversationFrame,
                            StreamFault | Cause.Done
                          >();
                          opens.push({ after, frames });
                          opened();
                          return Stream.fromQueue(frames);
                        }),
                      ),
                    subscribeRows: () => {
                      unexpected.push("subscribeRows");
                      return Stream.never;
                    },
                    readEarlier: () => unexpectedRead("readEarlier"),
                    readRun: () => unexpectedRead("readRun"),
                    readDetail: () => unexpectedRead("readDetail"),
                    watch: (_environmentId, receive) =>
                      Effect.sync(() => {
                        access = receive;
                      }),
                  },
                })
              : undefined;
          const waitForOpen = (count: number) =>
            new Promise<void>((resolve) => {
              if (opens.length >= count) resolve();
              else
                opened = () => {
                  if (opens.length >= count) resolve();
                };
            });
          const waitForPhase = (phase: string) =>
            new Promise<void>((resolve) => {
              const link = engineConversationLink(CARD_KEY);
              if (streamOf(account.store.state(), link).phase === phase) {
                resolve();
                return;
              }
              const stop = account.store.subscribe(() => {
                if (streamOf(account.store.state(), link).phase === phase) {
                  stop();
                  resolve();
                }
              });
            });
          let releaseRecovery = () => {};
          const engineOperations = makeMateEngineOperations({
            store: account.store,
            wire: {
              call: (_environment, command) => {
                calls.push(command);
                receivedCall();
                return Effect.succeed({
                  _tag: "Accepted",
                  seq: 2,
                  runId: "thread-card/r/2",
                  itemId: "thread-card/r/2/i/1",
                } as EngineCallResult);
              },
              receipt: () => Effect.succeed({ _tag: "None" }),
            },
            makeId: () => "generated-command",
          });
          account.registry.set(mateEngineHostAtom, {
            ...host,
            operations: engineOperations,
            conversations: conversations ?? {
              ...host.conversations,
              hold: () => () => {},
              holdRows: () => () => {},
            },
          });
          account.registry.set(mateConversationStoreAtom, account.store);
          account.store.dispatch({
            kind: "delivery",
            via: "mate-direct",
            reset: false,
            scopes: [{ scope: engineRowsScope(CARD_KEY.environmentId), generation: 0 }],
            rows: [
              {
                family: "mateEngineRow",
                id: engineFactId(CARD_KEY.environmentId, CARD_KEY.conversationId),
                value: {
                  ...engineRow(CARD_KEY.environmentId, CARD_KEY.conversationId, {
                    subject: "Existing conversation",
                  }),
                  environmentId: CARD_KEY.environmentId,
                },
                revision: {
                  kind: "mate-conversation",
                  environmentId: CARD_KEY.environmentId,
                  epoch: 1,
                  seq: 1,
                },
              },
            ],
            removals: [],
          });
          const shellScope = "mate:env-card:conversation-shell:env-card" as const;
          for (const event of [
            { kind: "demand" as const, demanded: true },
            { kind: "attempt" as const },
            { kind: "handshake" as const },
          ])
            account.store.dispatch({ kind: "stream", key: shellScope, now: 0, event });
          account.store.dispatch({ kind: "baseline-begin", scope: shellScope, generation: 1 });
          account.store.dispatch({
            kind: "baseline-commit",
            scope: shellScope,
            generation: 1,
            via: "mate-direct",
            members: ["env-card"],
            rows: [
              {
                family: "mateShell",
                id: "env-card",
                revision: { kind: "mate-link", sequence: 1 },
                value: {
                  state: {
                    status: "live",
                    error: Option.none(),
                    snapshot: Option.some({
                      snapshotSequence: 1,
                      updatedAt: "2026-10-07T00:00:00Z",
                      threads: [],
                      projects: [
                        {
                          id: "env-card" as never,
                          title: "Ada",
                          workspaceRoot: "/workspace",
                          repositoryIdentity: null,
                          defaultModelSelection: null,
                          scripts: [],
                          createdAt: "2026-10-07T00:00:00Z",
                          updatedAt: "2026-10-07T00:00:00Z",
                        },
                      ],
                    }),
                  },
                },
              },
            ],
          });
          if (kind === "sidebar") {
            const run = `${CARD_KEY.conversationId}/r/1`;
            account.publish({
              runs: [
                engineRun(CARD_KEY.conversationId, 1, {
                  summary: {
                    items: 2,
                    calls: {},
                    answerItemId: `${run}/i/2` as never,
                    lastItemSeq: 2,
                  },
                }),
              ],
              items: [
                personItem(run, 1, "Earlier question"),
                noteItem(run, 2, "The existing conversation is still here"),
              ],
            });
          } else if (conversations === undefined) account.publish(CARD_RECORDS);
          else {
            const first = waitForOpen(1);
            releaseRecovery = conversations.hold(CARD_KEY);
            await first;
            const live = waitForPhase("live");
            const run = `${CARD_KEY.conversationId}/r/2`;
            Queue.offerUnsafe(opens[0]!.frames, {
              type: "snapshot",
              protocol: 1,
              epoch: 4,
              origin: "origin-a",
              head: 12,
              header: recoveryHeader(run, true),
              runs: [
                engineRun(CARD_KEY.conversationId, 1, {
                  summary: {
                    items: 2,
                    calls: {},
                    answerItemId: `${CARD_KEY.conversationId}/r/1/i/2` as never,
                    lastItemSeq: 2,
                  },
                }),
                engineRun(CARD_KEY.conversationId, 2, {
                  state: "running",
                  end: null,
                  endedAt: null,
                }),
              ],
              items: [
                personItem(`${CARD_KEY.conversationId}/r/1`, 1, "Earlier question"),
                noteItem(
                  `${CARD_KEY.conversationId}/r/1`,
                  2,
                  "The existing conversation is still here",
                ),
                personItem(run, 1, "Continue"),
              ],
              requests: [],
              window: { oldestOrdinal: 1, earlier: false },
            });
            Queue.offerUnsafe(opens[0]!.frames, { type: "synchronized", epoch: 4, head: 12 });
            await live;
          }
          mountRoster(
            account.registry,
            organization.organizationId,
            [
              {
                id: projectId,
                clientId: organization.organizationId,
                name: "Ada",
                status: "ACTIVE",
                ...(kind === "review"
                  ? { userRoles: [{ clientUserId: "member", roleCode: "BASIC_USER" }] }
                  : {}),
                publicZone: "example.test",
                zeropsSubdomainHost: "ada",
              },
            ],
            {
              into: account.store,
              services: [
                {
                  id: "service-1",
                  projectId,
                  name: "zcp",
                  status: "ACTIVE",
                  subdomainAccess: true,
                  ports: [{ port: 8080, httpSupport: true }],
                  serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
                },
              ],
            },
          );
          if (kind === "review") {
            for (const input of membershipInputs(
              actor === "owner" ? "OWNER" : "NO_ACCESS",
              true,
              1,
              organization.organizationId,
            ))
              account.store.dispatch(input);
          }
          const roleCode = actor === "owner" ? "ADMIN" : "NO_ACCESS";
          account.registry.set(accountReadsAtom, {
            viewer: {
              id: actor,
              name: actor === "owner" ? "Owner" : "Colleague",
              membershipId: "member",
              roleCode,
            },
            data: account.store.data,
            orgId: organization.organizationId,
            demandDetail: () => () => {},
            renewHeld: () => {},
          });
          account.registry.set(zeropsSessionAtom, {
            status: "signed-in",
            organizationStatus: "selected",
            activeOrganization: organization,
          });
          const change = decodeChange({
            appId: "shop",
            repo: "appdev",
            number: 1,
            mateProjectId: "Ada",
            title: "Add the order summary",
            body: "Shows the order total before checkout.",
            state: "open",
            head: "a".repeat(40),
            mergedSha: null,
            landedHead: null,
            openedAt: "2026-10-07T00:00:00Z",
            updatedAt: "2026-10-07T00:00:00Z",
            mergedAt: null,
            closedAt: null,
            mergeability: "clean",
            behind: false,
            ready: true,
            comments: 0,
          });
          seedHqNavigation(account.store, organization.organizationId, {
            structure:
              kind === "review"
                ? {
                    apps: [
                      {
                        id: "shop",
                        name: "Shop",
                        projects: [
                          {
                            projectId,
                            name: "Ada",
                            kind: "mate",
                            mate: { face: "sky:seal", madeBy: "owner" },
                          },
                        ],
                      },
                    ],
                    ungrouped: [],
                  }
                : {
                    apps: [],
                    ungrouped: [{ projectId, name: "Ada", mate: { face: "sky:seal" } }],
                  },
            ...(kind === "review"
              ? {
                  person: {
                    mine: actor === "owner",
                    ownerUserId: "owner",
                    waitsOnViewer: false,
                    unseen: null,
                  },
                  people: { owner: { name: "Owner" } },
                  changes: { shop: [{ ...change, state: "open" as const, hasHead: true }] },
                }
              : {}),
            mates: {
              [projectId]: {
                presence: { online: true, since: "2026-10-07T00:00:00Z", overview: "live" },
                identity: {
                  environmentId: CARD_THREAD.environmentId,
                  serverVersion: version,
                  update: null,
                },
              },
            },
          });
          if (kind === "review") {
            const appScope = `hq:${organization.organizationId}:hq-app-detail:shop` as const;
            for (const event of [
              { kind: "demand" as const, demanded: true },
              { kind: "attempt" as const },
              { kind: "handshake" as const },
            ])
              account.store.dispatch({ kind: "stream", key: appScope, now: 0, event });
            account.store.dispatch({ kind: "baseline-begin", scope: appScope, generation: 1 });
            account.store.dispatch({
              kind: "baseline-commit",
              scope: appScope,
              generation: 1,
              via: "hq-stream",
              members: ["shop/changes"],
              rows: [
                {
                  family: "hqAppDetail",
                  id: "shop/changes",
                  value: { kind: "changes", value: [change] },
                  revision: { kind: "hq", incarnation: "review", revision: 1 },
                },
              ],
            });
            account.store.dispatch({
              kind: "stream",
              key: appScope,
              now: 0,
              event: { kind: "baseline-committed" },
            });
            const owner = changeReadOwner({
              link: { appId: "shop", repo: "appdev", number: 1 },
              snapshot: { expectedHead: change.head! },
              judged: "mergeable",
            });
            const metadataScope = changeMetadataScope(organization.organizationId, owner);
            for (const event of [
              { kind: "demand" as const, demanded: true },
              { kind: "attempt" as const },
              { kind: "handshake" as const },
            ])
              account.store.dispatch({ kind: "stream", key: metadataScope, now: 0, event });
            account.store.dispatch({ kind: "baseline-begin", scope: metadataScope, generation: 1 });
            const id = changeReadId(organization.organizationId, owner);
            account.store.dispatch({
              kind: "baseline-commit",
              scope: metadataScope,
              generation: 1,
              via: "hq-stream",
              members: [id],
              rows: [
                {
                  family: "hqChangeMetadata",
                  id,
                  revision: { kind: "hq", incarnation: change.head!, revision: 1 },
                  value: {
                    change,
                    review: {
                      mergeBase: null,
                      files: [],
                      filesTruncated: false,
                      conflictPaths: [],
                      commits: [],
                      commitsTruncated: false,
                    },
                  },
                },
              ],
            });
            account.store.dispatch({
              kind: "stream",
              key: metadataScope,
              now: 0,
              event: { kind: "baseline-committed" },
            });
          }
          const config: ServerConfig = {
            environment: {
              environmentId: CARD_THREAD.environmentId,
              label: "Card",
              platform: { os: "linux", arch: "x64" },
              serverVersion: version,
              capabilities: {
                repositoryIdentity: true,
                connectionProbe: true,
                agentLoginCode: true,
              },
              zerops: { projectId, identity: "ok" },
            },
            auth: {
              policy: "remote-reachable",
              bootstrapMethods: ["one-time-token"],
              sessionMethods: ["bearer-access-token"],
              sessionCookieName: "scenario_session",
            },
            cwd: "/workspace",
            keybindingsConfigPath: "/workspace/keybindings.json",
            keybindings: [],
            issues: [],
            availableEditors: [],
            providers: [
              decodeProvider({
                instanceId: "claudeAgent",
                driver: "claudeAgent",
                enabled: true,
                installed: true,
                version: "2.1.0",
                status: kind === "one-voice" ? "error" : "ready",
                ...(kind === "one-voice"
                  ? {
                      message:
                        "Claude Code is not signed in on this project. Sign it in to use it.",
                      compatibilityAdvisory: {
                        status: "unsupported",
                        message: "Update Claude to a supported version.",
                        recommendedVersion: null,
                        recommendedRange: null,
                      },
                    }
                  : {}),
                auth: { status: "authenticated" },
                checkedAt: "2026-10-07T00:00:00Z",
                requiresNewThreadForModelChange: true,
                setup: { canAuthenticate: true, canInstall: false },
                models: [
                  {
                    slug: "claude-sonnet-4-5",
                    name: "Claude Sonnet",
                    isCustom: false,
                    isDefault: true,
                    capabilities: null,
                  },
                ],
              }),
            ],
            observability: {
              logsDirectoryPath: "/tmp/logs",
              localTracingEnabled: false,
              otlpTracesEnabled: false,
              otlpMetricsEnabled: false,
              otlpLogsEnabled: false,
            },
            settings: DEFAULT_SERVER_SETTINGS,
          };
          const event = { type: "snapshot" as const, version: 1 as const, config };
          const readyAuth: ZeropsAgentAuthSnapshot = {
            available: true,
            agents: [
              {
                agentId: "claude-code",
                credPresent: true,
                flagOAuth: true,
                flagToken: false,
                providerAuth: "authenticated",
                state: "authorized",
                authorizedBy: { subject: "owner" },
              },
            ],
          };
          const signedOutAuth: ZeropsAgentAuthSnapshot = {
            ...readyAuth,
            agents: readyAuth.agents.map((agent) => ({
              ...agent,
              state: "not-authorized",
              credPresent: false,
              flagOAuth: false,
              providerAuth: "unauthenticated",
              authorizedBy: undefined,
            })),
          };
          const feeds = makeMateFeeds({
            store: account.store,
            wire: {
              open: (key) =>
                key.family === "mateServerConfig"
                  ? Stream.concat(
                      Stream.make(
                        { kind: "session" as const },
                        {
                          kind: "value" as const,
                          value: { config, latestEvent: event, source: "live" as const },
                        },
                      ),
                      Stream.never,
                    )
                  : key.family === "mateAgentAuth"
                    ? Stream.concat(
                        Stream.make(
                          { kind: "session" as const },
                          {
                            kind: "value" as const,
                            value: kind === "one-voice" ? signedOutAuth : readyAuth,
                          },
                        ),
                        Stream.fromQueue(authEvents),
                      )
                    : Stream.never,
            },
          });
          account.registry.set(mateFeedReadsAtom, { data: account.store.data, ...feeds });
          let stopConfig = () => {};
          await new Promise<void>((resolve) => {
            stopConfig = account.registry.subscribe(
              serverEnvironment.configValueAtom(CARD_THREAD.environmentId),
              (reading) => {
                if (reading !== null) resolve();
              },
              { immediate: true },
            );
          });
          const stopThread = account.registry.mount(
            environmentThreadDetails.detailAtom(CARD_THREAD),
          );
          expect(
            account.registry.get(account.store.data.project(engineThread, CARD_KEY)).data._tag,
          ).toBe("Some");
          expect(
            account.registry.get(environmentThreadDetails.detailAtom(CARD_THREAD)),
          ).not.toBeNull();
          expect(
            account.registry.get(serverEnvironment.configValueAtom(CARD_THREAD.environmentId))
              ?.environment.serverVersion,
          ).toBe(version);

          const node = document.body.appendChild(document.createElement("div"));
          const root = createRoot(node);
          const router = createRouter({
            history: createMemoryHistory({ initialEntries: ["/"] }),
            routeTree: createRootRoute(),
          });
          await act(() => router.load());
          const operations = accountOperations(
            account.store,
            account.registry,
            {} as never,
            () => () => {},
            () => {},
            async () => false,
          );
          const reads = {
            data: account.store.data,
            orgId: organization.organizationId,
            demandDetail: () => () => {},
            revalidate: () => {},
          } as unknown as AccountData;
          const session = {
            status: "signed-in",
            activeOrganization: {
              id: organization.organizationId,
              name: "Example",
              membershipId: "member",
              roleCode,
              status: "ACTIVE",
            },
            organizationStatus: "selected",
            user: { id: actor, name: actor === "owner" ? "Owner" : "Colleague" },
            organizations: [],
          } as unknown as ZeropsSessionValue;
          const inventory = account.registry.get(
            account.store.data.project(inventoryContents, {
              organization,
              viewer: session.activeOrganization ?? undefined,
            }),
          );
          const platform = {
            scope: scope(),
            signals: { hidden: () => false, online: () => true, listen: () => () => {} },
            organizationRef: () => organization,
            projectRef: () => project(),
          } as unknown as ZeropsDataContextValue;
          try {
            await act(async () =>
              root.render(
                <RouterContextProvider router={router}>
                  <Suspense fallback="suspended">
                    <RegistryContext value={account.registry}>
                      <ZeropsSessionContext value={session}>
                        <ZeropsDataContext value={platform}>
                          <AccountStoreContext value={account.store}>
                            <AccountDataContext value={reads}>
                              <AccountOperationsContext value={operations}>
                                <InventoryContext value={inventory}>
                                  <ZeropsReviewProvider>
                                    <AgentAdmissionComposition>
                                      {kind === "sidebar" ||
                                      kind === "review" ||
                                      kind === "one-voice" ? (
                                        <SidebarProvider defaultOpen>
                                          <SidebarAccountMenuProvider>
                                            <Sidebar />
                                          </SidebarAccountMenuProvider>
                                        </SidebarProvider>
                                      ) : null}
                                      <ChatView {...CARD_THREAD} routeKind="server" />
                                    </AgentAdmissionComposition>
                                  </ZeropsReviewProvider>
                                </InventoryContext>
                              </AccountOperationsContext>
                            </AccountDataContext>
                          </AccountStoreContext>
                        </ZeropsDataContext>
                      </ZeropsSessionContext>
                    </RegistryContext>
                  </Suspense>
                </RouterContextProvider>,
              ),
            );
            await settleFrames();
            if (kind === "review") {
              const header = node.querySelector('[class~="@container/header-actions"]');
              expect(header?.textContent).toContain("Review");
              const button = header?.querySelector<HTMLButtonElement>(
                'button[aria-label="Review Add the order summary"]',
              );
              expect(button).not.toBeNull();
              if (actor === "colleague")
                expect(node.textContent).toContain("Ada is Owner's Mate — you can read along.");
              await act(async () => button!.click());
              await act(async () => {
                await import("./zerops/review/ZeropsChangeReview");
              });
              await settleFrames();
              expect(document.body.textContent).toContain("What it does");
              expect(document.body.textContent).toContain("Shows the order total before checkout.");
              await act(async () =>
                document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click(),
              );
              await settleFrames();
              expect(document.querySelector('[role="dialog"]')).toBeNull();
              expect(external).not.toHaveBeenCalled();
              expect(sockets).not.toHaveBeenCalled();
              return;
            }
            if (kind === "recovery") {
              expect(
                Option.getOrThrow(
                  account.registry.get(account.store.data.project(engineThread, CARD_KEY)).data,
                ).latestTurn?.state,
              ).toBe("running");
              expect(
                [...node.querySelectorAll("button")].map((button) =>
                  button.getAttribute("aria-label"),
                ),
              ).toContain("Stop generation");
              const timelineBefore = node.querySelector("[data-timeline-thread]");
              expect(
                timelineBefore?.textContent?.split("The existing conversation is still here"),
              ).toHaveLength(2);
              await act(async () =>
                useComposerDraftStore
                  .getState()
                  .setPrompt(CARD_THREAD, "Keep this draft through the interruption"),
              );
              expect(node.querySelector('[data-testid="composer-editor"]')?.textContent).toBe(
                "Keep this draft through the interruption",
              );
              const recovering = waitForPhase("recovering");
              await act(async () => {
                Queue.failCauseUnsafe(
                  opens[0]!.frames,
                  Cause.fail({ outcome: "transient", message: "socket closed" }),
                );
                await recovering;
              });
              const reopened = waitForOpen(2);
              await act(async () => {
                access?.(null);
                await reopened;
              });
              expect(opens[1]!.after).toEqual({ epoch: 4, origin: "origin-a", seq: 12 });
              const live = waitForPhase("live");
              const run = `${CARD_KEY.conversationId}/r/2`;
              await act(async () => {
                Queue.offerUnsafe(opens[1]!.frames, {
                  type: "changes",
                  epoch: 4,
                  from: 12,
                  to: 13,
                  header: recoveryHeader(run, false),
                  runs: [
                    engineRun(CARD_KEY.conversationId, 2, {
                      rev: 13,
                      end: { kind: "stopped", by: { kind: "person", subject: "owner" } },
                    }),
                  ],
                  items: [],
                  requests: [],
                });
                Queue.offerUnsafe(opens[1]!.frames, { type: "synchronized", epoch: 4, head: 13 });
                await live;
              });
              await settleFrames();
              expect(node.querySelector('button[aria-label="Stop generation"]')).toBeNull();
              const timeline = node.querySelector("[data-timeline-thread]");
              expect(
                timeline?.textContent?.split("The existing conversation is still here"),
              ).toHaveLength(2);
              expect(node.querySelector('[data-testid="composer-editor"]')?.textContent).toBe(
                "Keep this draft through the interruption",
              );
              expect(calls).toEqual([]);
              expect(unexpected).toEqual([]);
              expect(external).not.toHaveBeenCalled();
              expect(sockets).not.toHaveBeenCalled();
              return;
            }
            if (kind === "sidebar") {
              expect(node.querySelector("[data-timeline-thread]")?.textContent).toContain(
                "The existing conversation is still here",
              );
              const shells = account.registry.get(environmentThreadShells.threadShellsAtom);
              const conversation = shells.find((shell) => shell.id === CARD_KEY.conversationId);
              expect(conversation?.title).toBe("Existing conversation");
              expect(conversation?.crew).toBeUndefined();
              expect(node.querySelectorAll("[data-thread-item]")).toHaveLength(0);
              expect(node.querySelectorAll('[data-zerops-mate-row="Ada"]')).toHaveLength(1);
              expect(external).not.toHaveBeenCalled();
              expect(sockets).not.toHaveBeenCalled();
              return;
            }
            if (kind === "one-voice") {
              const explanations = () =>
                [...node.querySelectorAll('[role="status"], [role="alert"]')]
                  .filter((item) => !item.closest("[inert]"))
                  .map((item) => item.textContent ?? "")
                  .filter((text) => /sign-in|signed in|signed out|authorization/iu.test(text));
              expect(explanations()).toEqual(["Ada needs a Claude sign-in to continue.Sign in"]);
              expect(
                [...node.querySelectorAll('[aria-label="Ada: Sign in"]')].filter(
                  (item) => !item.closest('[data-zerops-surface="sidebar-mate"]'),
                ),
              ).toEqual([]);
              const send = node.querySelector<HTMLButtonElement>(
                'button[aria-label="Ada needs a Claude sign-in to continue."]',
              );
              expect(send?.disabled).toBe(true);
              const advisory = async () => {
                const picker = node.querySelector<HTMLElement>(
                  "[data-chat-provider-model-picker]",
                )!;
                const dots = [...picker.querySelectorAll('[role="img"]')];
                expect(dots).toHaveLength(1);
                expect(dots[0]?.getAttribute("aria-label")).toMatch(/ is unsupported$/u);
                expect(dots[0]?.getAttribute("data-tone")).toBe("warning");
                await act(async () => {
                  picker.focus();
                  picker.click();
                });
                expect(document.querySelector("[data-agent-availability]")?.textContent).toContain(
                  "Update Claude to a supported version.",
                );
                await act(async () =>
                  document.activeElement!.dispatchEvent(
                    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
                  ),
                );
                await settleFrames();
                expect(document.querySelector("[data-agent-availability]")).toBeNull();
              };
              await advisory();
              const authAtom = mateFeedAtom({
                family: "mateAgentAuth",
                environmentId: CARD_THREAD.environmentId,
                input: {},
              });
              let stopAuth = () => {};
              await act(async () => {
                const seen = new Promise<void>((resolve) => {
                  stopAuth = account.registry.subscribe(
                    authAtom,
                    (read) => {
                      if (read.state === "known" && read.value.agents[0]?.state === "authorized")
                        resolve();
                    },
                    { immediate: true },
                  );
                });
                Queue.offerUnsafe(authEvents, { kind: "value", value: readyAuth });
                await seen;
              });
              stopAuth();
              expect(explanations()).toEqual([]);
              expect(node.textContent).not.toContain(
                "Claude Code is not signed in on this project.",
              );
              await advisory();
              await act(async () =>
                account.publish({
                  ...CARD_RECORDS,
                  runs: [
                    ...CARD_RECORDS.runs,
                    engineRun(CARD_KEY.conversationId, 2, {
                      end: {
                        kind: "failed",
                        reason:
                          "Claude's sign-in has expired. Sign Claude in again, then send a message to pick up where it left off.",
                        next: null,
                      },
                    }),
                  ],
                  items: [...CARD_RECORDS.items, personItem("thread-card/r/2", 1, "Continue")],
                }),
              );
              await settleFrames();
              expect(node.querySelector("[data-timeline-thread]")?.textContent).toContain(
                "Claude was signed out.",
              );
              const at = "2026-10-07T00:00:00Z";
              const expired =
                "Claude's sign-in has expired. Sign Claude in again, then send a message to pick up where it left off.";
              await act(async () =>
                account.store.dispatch({
                  kind: "delivery",
                  via: "mate-direct",
                  reset: false,
                  scopes: [{ scope: engineRowsScope(CARD_KEY.environmentId), generation: 0 }],
                  rows: [
                    {
                      family: "mateEngineRow",
                      id: engineFactId(CARD_KEY.environmentId, CARD_KEY.conversationId),
                      value: {
                        ...engineRow(CARD_KEY.environmentId, CARD_KEY.conversationId, {
                          subject: "Existing conversation",
                          state: { kind: "failed", errorLine: expired },
                          latestRun: {
                            id: RunId.make("thread-card/r/2"),
                            end: { kind: "failed", reason: expired, next: null },
                            endedAt: Date.parse(at),
                          },
                        }),
                        environmentId: CARD_KEY.environmentId,
                      },
                      revision: {
                        kind: "mate-conversation",
                        environmentId: CARD_KEY.environmentId,
                        epoch: 1,
                        seq: 2,
                      },
                    },
                  ],
                  removals: [],
                }),
              );
              await act(async () =>
                seedHqNavigation(account.store, organization.organizationId, {
                  mates: {
                    Ada: {
                      presence: { online: true, since: at, overview: "live" },
                      identity: {
                        environmentId: CARD_THREAD.environmentId,
                        serverVersion: version,
                        update: null,
                      },
                      main: {
                        id: CARD_THREAD.threadId,
                        title: "Inspect the checkout",
                        hasPendingApprovals: false,
                        hasPendingUserInput: false,
                        hasActionableProposedPlan: false,
                        interactionMode: "default",
                        backgroundLiveness: null,
                        session: { status: "error", lastError: expired },
                        latestTurn: null,
                        latestUserMessageAt: at,
                        updatedAt: at,
                        latestMessagePreview: null,
                        latestUserMessagePreview: { text: "Inspect the checkout" },
                        planProgress: null,
                        pendingQuestion: null,
                        usagePause: null,
                        liveStep: null,
                      },
                    },
                  },
                  attention: {
                    Ada: {
                      source: {
                        environmentId: CARD_THREAD.environmentId,
                        epoch: 1,
                        incarnation: "refused",
                        revision: 1,
                      },
                      mainThreadId: CARD_THREAD.threadId,
                      lastThreadId: CARD_THREAD.threadId,
                      working: 0,
                      waiting: 1,
                      results: [],
                      questions: [{ threadId: CARD_THREAD.threadId, kind: "failed", turnId: null }],
                      truncated: false,
                    },
                  },
                }),
              );
              await settleFrames();
              expect(
                node.querySelector('[data-zerops-surface="sidebar-mate"]')?.textContent,
              ).toContain("Ada's turn could not continue because Claude was signed out.");
              expect(external).not.toHaveBeenCalled();
              expect(sockets).not.toHaveBeenCalled();
              return;
            }
            await act(async () =>
              useComposerDraftStore.getState().setPrompt(CARD_THREAD, "Start work"),
            );
            const send = node.querySelector<HTMLButtonElement>('button[aria-label="Send message"]');
            expect(send).not.toBeNull();
            expect(send?.disabled).toBe(false);
            await act(async () => {
              send!.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
              await called;
            });
            expect(calls).toHaveLength(1);
            const command = calls[0]!;
            expect(command).toMatchObject({ kind: "send", text: "Start work", attachments: [] });
            if (command.kind !== "send") throw new Error("expected send");
            await act(async () => {
              account.publish({
                ...CARD_RECORDS,
                runs: [
                  ...CARD_RECORDS.runs,
                  engineRun(CARD_KEY.conversationId, 2, {
                    startedAt: null,
                    end: {
                      kind: "failed",
                      reason: "Claude's sign-in has expired. Sign Claude in again.",
                      next: null,
                      admission: { loginId: "claude-code", reason: "expired-login" },
                    },
                  }),
                ],
                items: [
                  ...CARD_RECORDS.items,
                  personItem("thread-card/r/2", 1, "Start work", {
                    sendId: CommandId.make(command.commandId),
                    delivery: { state: "refused", at: null },
                  }),
                ],
              });
            });
            await settleFrames();
            const timeline = node.querySelector("[data-timeline-thread]");
            expect(timeline?.getAttribute("data-timeline-placing")).toBeNull();
            expect(timeline?.closest("[inert]")).toBeNull();
            expect(timeline?.textContent).toContain("Claude was signed out.");
            const authAtom = mateFeedAtom({
              family: "mateAgentAuth",
              environmentId: CARD_THREAD.environmentId,
              input: {},
            });
            let stopAuth = () => {};
            await act(async () => {
              const seen = new Promise<void>((resolve) => {
                stopAuth = account.registry.subscribe(
                  authAtom,
                  (read) => {
                    if (read.state === "known" && read.value.agents[0]?.state === "not-authorized")
                      resolve();
                  },
                  { immediate: true },
                );
              });
              Queue.offerUnsafe(authEvents, {
                kind: "value",
                value: {
                  ...readyAuth,
                  agents: readyAuth.agents.map(
                    (agent): ZeropsAgentAuthSnapshot["agents"][number] => ({
                      ...agent,
                      state: "not-authorized",
                      credPresent: false,
                      flagOAuth: false,
                      providerAuth: "unauthenticated",
                      authorizedBy: undefined,
                    }),
                  ),
                },
              });
              await seen;
            });
            stopAuth();
            const explanations = [...node.querySelectorAll('[role="status"], [role="alert"]')]
              .filter((item) => !item.closest("[inert]"))
              .map((item) => item.textContent ?? "")
              .filter((text) => /sign-in|signed in|signed out|authorization/iu.test(text));
            expect(explanations).toEqual(["Ada needs a Claude sign-in to continue.Sign in"]);
            expect(node.querySelector('[data-testid="composer-editor"]')?.textContent).toBe(
              "Start work",
            );
            expect(send?.disabled).toBe(true);
            expect(external).not.toHaveBeenCalled();
            expect(sockets).not.toHaveBeenCalled();
          } finally {
            await act(async () => root.unmount());
            node.remove();
            stopThread();
            stopConfig();
            releaseRecovery();
            conversations?.close();
            feeds.close();
            closeAccountLifetime();
            account.close();
          }
        }
      } finally {
        if (kind === "review") showProjectParts([]);
        vi.unstubAllGlobals();
      }
    });
  });

describe("C: agent selection and contextual drafts", () => {
  it.effect(
    "a Mate's change waiting for a review stands in its conversation's header, for its owner and a colleague reading along, and opens from there",
    () =>
      Effect.gen(function* () {
        yield* admissionScenario("review", "owner");
        yield* admissionScenario("review", "colleague");
      }),
  );
});

describe("C: source failures keep the conversation", () => {
  it.effect("an active run interrupted during transport loss returns with history and draft", () =>
    admissionScenario("recovery"),
  );
});

describe("C: opening a Mate and chat", () => {
  it.effect(
    "a Mate's non-crewmate engine conversation never becomes a generic sidebar thread",
    () => admissionScenario("sidebar"),
  );
});

describe("C: agent admission", () => {
  it.effect("A refused first turn has one explanation scoped to the attempted login", () =>
    admissionScenario("refused"),
  );
  it.effect(
    "Decision: one voice. When the chat’s composer shows the sign-in explanation, the header shows no separate Sign in chip for the same occurrence.",
    () => admissionScenario("one-voice"),
  );
});
