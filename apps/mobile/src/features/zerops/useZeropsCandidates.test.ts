import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import {
  initialEnvironment,
  type EnvironmentMachine,
  type TargetKey,
} from "@t3tools/client-runtime/zerops/environments";
import { reactHookHarness as hooks } from "../../../../web/src/test/reactHookHarness";
import {
  NOT_READ_PROCESSES,
  projectProcessesAtom,
  shownProjectsAtom,
  type ProjectProcesses,
} from "@t3tools/client-runtime/data";
import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";

interface TestBinding {
  readonly released: Array<{ readonly kind: string }>;
  readonly projectAtom: unknown;
  readonly serviceAtom: unknown;
  readonly stateAtom: unknown;
}

const runtime = vi.hoisted(() => ({
  binding: null as TestBinding | null,
  acquire: vi.fn(),
  retry: vi.fn(),
  registry: {
    get: vi.fn(),
    subscribe: vi.fn(),
  },
}));
const session = vi.hoisted(() => ({ status: "signed-in", activeId: "org-a" as string | null }));
const reads = vi.hoisted(() => ({
  services: null as unknown,
  project: null as unknown,
  processes: null as unknown,
}));
/** The account runtime's Mate environments, as the provider binds them after the first grant. */
const stage = vi.hoisted(() => ({
  machines: new Map() as ReadonlyMap<string, unknown>,
}));
const scopes = vi.hoisted(() => {
  let pending = false;
  let scope: object = {};
  let resolveScope: ((value: object) => void) | null = null;
  let pendingScope: Promise<object> = Promise.resolve(scope);
  let resolveClosed: (() => void) | null = null;
  let closed: Promise<void> = Promise.resolve();
  const closeCalls: object[] = [];

  return {
    close: (value: object) => {
      closeCalls.push(value);
      resolveClosed?.();
    },
    closeCalls,
    defer() {
      pending = true;
      scope = {};
      pendingScope = new Promise((resolve) => {
        resolveScope = resolve;
      });
      closed = new Promise((resolve) => {
        resolveClosed = resolve;
      });
    },
    make: () => (pending ? pendingScope : Promise.resolve(scope)),
    reset() {
      pending = false;
      scope = {};
      resolveScope = null;
      pendingScope = Promise.resolve(scope);
      resolveClosed = null;
      closed = Promise.resolve();
      closeCalls.length = 0;
    },
    resolve() {
      resolveScope?.(scope);
      pending = false;
    },
    waitForClose: () => closed,
  };
});

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../../../web/src/test/reactHookHarness");
  return {
    ...actual,
    useCallback: reactHookHarness.useCallback,
    useEffect: reactHookHarness.useEffect,
    useMemo: reactHookHarness.useMemo,
    useRef: reactHookHarness.useRef,
    useState: reactHookHarness.useState,
    useSyncExternalStore: reactHookHarness.useSyncExternalStore,
  };
});

vi.mock("./ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({
    status: session.status,
    organizations: ORGANIZATIONS,
    activeOrganization: session.activeId === null ? null : { id: session.activeId },
  }),
}));
vi.mock("./ZeropsDataProvider", () => ({
  useZeropsData: () => ({
    binding: runtime.binding,
    environments: {
      machines: () => stage.machines,
      subscribe: () => () => undefined,
    },
    error: null,
  }),
}));
vi.mock("effect/Scope", async (importOriginal) => {
  const actual = await importOriginal<typeof import("effect/Scope")>();
  const Effect = await import("effect/Effect");
  return {
    ...actual,
    close: (scope: object) => Effect.sync(() => scopes.close(scope)),
    make: () => Effect.promise(() => scopes.make()),
    provide:
      () =>
      <Value>(effect: Value) =>
        effect,
  };
});

import { zeropsCandidatePresentation } from "./presentation";
import { useZeropsCandidates } from "./useZeropsCandidates";
import * as Effect from "effect/Effect";
import {
  makeZeropsApiOrigin,
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
} from "@t3tools/client-runtime/zerops/data";

// One array for every render: the session's organizations are the same list until they change.
const ORGANIZATIONS = [{ id: "org-a" }];

async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function render(
  openedProjectId: string | null = "project-a",
): ReturnType<typeof useZeropsCandidates> {
  hooks.beginRender();
  return useZeropsCandidates(openedProjectId);
}

const listenerOf = (atom: unknown): (() => void) | undefined =>
  runtime.registry.subscribe.mock.calls.find(([subscribed]) => subscribed === atom)?.[1] as
    | (() => void)
    | undefined;

describe("candidate inventory demand", () => {
  it.each([null, "org-b"])(
    "reads the organization %s off the account's store, demanding no inventory of it",
    async (id) => {
      session.activeId = id;
      render();
      await settle();
      expect(
        runtime.acquire.mock.calls.filter(([request]) => request.kind === "organization-inventory"),
      ).toEqual([]);
      expect(runtime.registry.subscribe.mock.calls.map(([atom]) => atom)).toContain(
        shownProjectsAtom,
      );
    },
  );

  it("keeps the project picker free of service detail until a project opens", async () => {
    render(null);
    await settle();
    expect(
      runtime.acquire.mock.calls.filter(([request]) => request.kind === "project-inventory"),
    ).toEqual([]);
  });

  beforeEach(() => {
    hooks.reset();
    runtime.acquire.mockReset();
    runtime.retry.mockReset();
    runtime.registry.get.mockReset();
    runtime.registry.subscribe.mockReset();
    scopes.reset();
    session.status = "signed-in";
    session.activeId = "org-a";
    stage.machines = new Map();

    const account = {
      apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
      accountId: ZeropsAccountId.make("account-a"),
    };
    const organization = {
      kind: "organization" as const,
      account,
      organizationId: ZeropsOrganizationId.make("org-a"),
    };
    const project = {
      kind: "project" as const,
      organization,
      projectId: ZeropsProjectId.make("project-a"),
    };
    const projectsAtom = shownProjectsAtom;
    const servicesAtom = {};
    const activityAtom = projectProcessesAtom("project-a");
    const stateAtom = {};
    // The organization's roster, as the account's store lists it.
    const projects = {
      orgId: "org-a",
      projects: [{ id: "project-a", name: "Demo", status: "ACTIVE" }],
      read: "read" as const,
      complete: true,
      live: true,
      reconnecting: false,
    };
    reads.services = {
      value: [],
      query: { status: "unresolved" as const, descriptor: { project } },
      observation: { required: [], optional: [], access: { status: "unverified" as const } },
    };
    reads.project = project;
    reads.processes = NOT_READ_PROCESSES;
    const released: Array<{ readonly kind: string }> = [];
    runtime.acquire.mockImplementation((descriptor: { readonly kind: string }) =>
      Effect.sync(() => ({
        leaseId: `lease:${descriptor.kind}`,
        interest: descriptor.kind,
        release: Effect.sync(() => released.push(descriptor)),
      })),
    );
    runtime.registry.get.mockImplementation((atom: unknown) =>
      atom === projectsAtom ? projects : atom === activityAtom ? reads.processes : reads.services,
    );
    runtime.registry.subscribe.mockImplementation(() => () => undefined);
    runtime.binding = {
      account: { account, epoch: 0 },
      accountData: { observation: { retry: runtime.retry } },
      runtime: {
        stateAtom,
        reads: { servicesOf: () => servicesAtom },
        acquire: runtime.acquire,
      },
      registry: runtime.registry,
      released,
      projectAtom: projectsAtom,
      serviceAtom: servicesAtom,
      stateAtom,
    } as TestBinding;
  });

  it("keeps every lease when a Mate connects", async () => {
    render();
    await settle();
    listenerOf(runtime.binding?.projectAtom)?.();
    await settle();
    const acquired = runtime.acquire.mock.calls.length;

    stage.machines = new Map<TargetKey, EnvironmentMachine>([
      [
        "project-a:service-a",
        {
          ...initialEnvironment({ record: null }),
          credential: {
            kind: "held",
            environmentId: EnvironmentId.make("environment-a"),
            installed: true,
            staleBlock: false,
            rereading: null,
          },
          link: { phase: "connected", since: { wall: 0, mono: 0 } },
        },
      ],
    ]);
    render();
    await settle();

    expect(runtime.binding?.released).toEqual([]);
    expect(runtime.acquire.mock.calls.length).toBe(acquired);
  });

  it("subscribes only to project and service reads, and releases its demand when the account leaves", async () => {
    render();
    await settle();
    listenerOf(runtime.binding?.projectAtom)?.();
    await settle();

    expect(runtime.acquire.mock.calls.map(([descriptor]) => descriptor.kind)).toEqual([
      "project-inventory",
    ]);
    const subscribed = runtime.registry.subscribe.mock.calls.map(([atom]) => atom);
    expect(subscribed).toContain(runtime.binding?.projectAtom);
    expect(subscribed).toContain(runtime.binding?.serviceAtom);
    expect(subscribed).not.toContain(runtime.binding?.stateAtom);

    session.status = "signed-out";
    expect(render().listing).toEqual({ state: "unread", waitingFor: null });
    await settle();
    expect(runtime.binding?.released.map((descriptor) => descriptor.kind)).toContain(
      "project-inventory",
    );
    expect(scopes.closeCalls).toHaveLength(1);
  });

  it("closes a scope created after the account left without acquiring any interest", async () => {
    scopes.defer();
    render();
    session.status = "signed-out";
    render();
    scopes.resolve();
    await scopes.waitForClose();

    expect(runtime.acquire).not.toHaveBeenCalled();
    expect(scopes.closeCalls).toHaveLength(1);
  });

  it("says why a refused demand left the listing unread, and asks again on refresh", async () => {
    runtime.acquire.mockImplementation((descriptor: { readonly kind: string }) =>
      descriptor.kind === "project-inventory"
        ? Effect.fail(new Error("project inventory denied"))
        : Effect.sync(() => ({
            leaseId: `lease:${descriptor.kind}`,
            interest: descriptor.kind,
            release: Effect.sync(() => undefined),
          })),
    );
    render();
    await settle();

    expect(render().error).toBe("project inventory denied");

    runtime.acquire.mockImplementation((descriptor: { readonly kind: string }) =>
      Effect.sync(() => ({
        leaseId: `lease:${descriptor.kind}`,
        interest: descriptor.kind,
        release: Effect.sync(() => undefined),
      })),
    );
    render().refresh();
    render();
    await settle();

    expect(render().error).toBeNull();
  });

  it("asks the account's observation again on refresh, keeping every lease", async () => {
    render();
    await settle();

    render().refresh();
    await settle();

    expect(runtime.retry).toHaveBeenCalledTimes(1);
    expect(runtime.binding?.released).toEqual([]);
  });

  it("gives a restarting Mate's row its container's verdict, never not-reachable", async () => {
    reads.services = {
      value: [
        {
          knowledge: "observed",
          record: {
            ref: { kind: "service", project: reads.project, serviceId: "service-a" },
            identity: {
              knowledge: "observed",
              fields: {
                hostname: "zcp",
                type: { versionName: "zcp@1", displayName: null, category: null },
              },
            },
            lifecycle: { knowledge: "observed", fields: { status: "RESTARTING" } },
            routing: { knowledge: "unresolved" },
            deployment: { knowledge: "unresolved" },
            scaling: { knowledge: "unresolved" },
          },
        },
      ],
      query: {
        status: "observed",
        descriptor: { project: reads.project },
        unresolvedMemberKeys: [],
        stamp: { receiptOrdinal: 2, observedAtMs: 20 },
        coverage: { kind: "exhausted-traversal" },
      },
      observation: { required: [], optional: [], access: { status: "unverified" } },
    };
    // The account's container store read the platform's restart into the Mate's machine.
    stage.machines = new Map<TargetKey, EnvironmentMachine>([
      [
        "project-a:service-a",
        {
          ...initialEnvironment({ record: null }),
          presence: { kind: "transitioning", status: "RESTARTING" },
          container: { level: "restarting", by: "platform", overdue: false },
        },
      ],
    ]);
    render();
    await settle();
    listenerOf(runtime.binding?.projectAtom)?.();
    await settle();

    const { listing } = render();
    const row = listing.state === "known" ? listing.value[0] : undefined;
    expect(row).toMatchObject({
      key: "project-a:service-a",
      reachability: {
        kind: "container",
        container: { level: "restarting", by: "platform" },
      },
    });
    expect(row === undefined ? null : zeropsCandidatePresentation(row, 0)).toMatchObject({
      label: "Restarting",
      notice: "Zerops is restarting this Mate.",
    });
  });

  // A phone opened while a Mate's container is ACTIVE before its address landed reads it as web
  // does (live run 3): on its way while the platform turns its address on, never "public access is
  // off" — and for as long as that process says so, never by a clock.
  describe("a Mate ACTIVE before its address landed", () => {
    const CREATED_AT = "2026-10-02T12:00:00.000Z";
    const CREATED = Date.parse(CREATED_AT);

    /** Its project's processes as read: an enable in this status, or none; not read where null. */
    const activityOf = (status: "RUNNING" | "FAILED" | "none" | null): ProjectProcesses => {
      if (status === null) return NOT_READ_PROCESSES;
      const enable: ActivityProcess = {
        id: "enable-1",
        projectId: "project-a",
        serviceStackIds: ["service-a"],
        status,
        actionName: "stack.enableSubdomainAccess",
        created: CREATED_AT,
      };
      return {
        processes: status === "none" ? [] : [enable],
        running: status === "RUNNING" ? [enable] : [],
        live: true,
        reconnecting: false,
        history: "read",
      };
    };

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
      vi.setSystemTime(CREATED + 110_000);
      reads.services = {
        value: [
          {
            knowledge: "observed",
            record: {
              ref: { kind: "service", project: reads.project, serviceId: "service-a" },
              identity: {
                knowledge: "observed",
                fields: {
                  hostname: "zcp",
                  type: { versionName: "zcp@1", displayName: null, category: null },
                },
              },
              lifecycle: {
                knowledge: "observed",
                fields: { status: "ACTIVE", createdAt: CREATED_AT, updatedAt: null },
              },
              routing: {
                knowledge: "observed",
                fields: {
                  subdomainAccess: false,
                  ports: [{ port: 8080, protocol: "TCP", scheme: "http", httpSupport: true }],
                },
              },
              deployment: { knowledge: "unresolved" },
              scaling: { knowledge: "unresolved" },
            },
          },
        ],
        query: {
          status: "observed",
          descriptor: { project: reads.project },
          unresolvedMemberKeys: [],
          stamp: { receiptOrdinal: 2, observedAtMs: 20 },
          coverage: { kind: "exhausted-traversal" },
        },
        observation: { required: [], optional: [], access: { status: "unverified" } },
      };
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    const rowOf = (listing: ReturnType<typeof useZeropsCandidates>["listing"]) =>
      listing.state === "known" ? listing.value[0] : undefined;

    it.each<{
      readonly case: string;
      readonly enable: "RUNNING" | "FAILED" | "none" | null;
      /** How long after it was first seen the row is read. */
      readonly afterMs: number;
      readonly group: "provisioning" | "unavailable";
    }>([
      {
        case: "its address being turned on: on its way",
        enable: "RUNNING",
        afterMs: 0,
        group: "provisioning",
      },
      {
        case: "elapsed time supplies no new platform fact",
        enable: "RUNNING",
        afterMs: 60 * 60_000,
        group: "provisioning",
      },
      {
        case: "its enable failed: no public address",
        enable: "FAILED",
        afterMs: 0,
        group: "unavailable",
      },
      {
        case: "nothing turns it on: no public address",
        enable: "none",
        afterMs: 0,
        group: "unavailable",
      },
      {
        case: "its processes not read yet, never watched: as the platform leaves it",
        enable: null,
        afterMs: 0,
        group: "unavailable",
      },
    ])("$case", async ({ enable, afterMs, group }) => {
      reads.processes = activityOf(enable);
      render();
      await settle();
      listenerOf(runtime.binding?.projectAtom)?.();
      await settle();

      vi.advanceTimersByTime(afterMs);
      listenerOf(runtime.binding?.projectAtom)?.();
      await settle();
      const row = rowOf(render().listing);
      expect(row?.group).toBe(group);
      if (group === "provisioning") {
        expect(row?.reason ?? "").not.toMatch(/public access/i);
      }
    });
  });
});
