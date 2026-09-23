import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import {
  initialEnvironment,
  type EnvironmentMachine,
  type TargetKey,
} from "@t3tools/client-runtime/zerops/environments";
import { reactHookHarness as hooks } from "../../../../web/src/test/reactHookHarness";

interface TestBinding {
  readonly released: Array<{ readonly kind: string }>;
  readonly projectAtom: unknown;
  readonly serviceAtom: unknown;
  readonly stateAtom: unknown;
}

const runtime = vi.hoisted(() => ({
  binding: null as TestBinding | null,
  acquire: vi.fn(),
  refresh: vi.fn(),
  registry: {
    get: vi.fn(),
    subscribe: vi.fn(),
  },
}));
const session = vi.hoisted(() => ({ status: "signed-in" }));
const reads = vi.hoisted(() => ({ services: null as unknown, project: null as unknown }));
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
    useState: reactHookHarness.useState,
    useSyncExternalStore: reactHookHarness.useSyncExternalStore,
  };
});

vi.mock("./ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({ status: session.status, organizations: ORGANIZATIONS }),
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

function render(): ReturnType<typeof useZeropsCandidates> {
  hooks.beginRender();
  return useZeropsCandidates();
}

const listenerOf = (atom: unknown): (() => void) | undefined =>
  runtime.registry.subscribe.mock.calls.find(([subscribed]) => subscribed === atom)?.[1] as
    | (() => void)
    | undefined;

describe("candidate inventory demand", () => {
  beforeEach(() => {
    hooks.reset();
    runtime.acquire.mockReset();
    runtime.refresh.mockReset().mockReturnValue(Effect.void);
    runtime.registry.get.mockReset();
    runtime.registry.subscribe.mockReset();
    scopes.reset();
    session.status = "signed-in";
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
    const projectsAtom = {};
    const servicesAtom = {};
    const stateAtom = {};
    const projects = {
      value: [
        {
          knowledge: "observed" as const,
          record: {
            ref: project,
            identity: { knowledge: "observed" as const, fields: { name: "Demo" } },
            lifecycle: { knowledge: "observed" as const, fields: { status: "ACTIVE" } },
            presentation: { knowledge: "unresolved" as const },
            placement: { knowledge: "unresolved" as const },
          },
        },
      ],
      query: {
        status: "observed" as const,
        descriptor: { organization },
        unresolvedMemberKeys: [],
        stamp: { receiptOrdinal: 1, observedAtMs: 10 },
        coverage: { kind: "exhausted-traversal" as const },
      },
      observation: { required: [], optional: [], access: { status: "unverified" as const } },
    };
    reads.services = {
      value: [],
      query: { status: "unresolved" as const, descriptor: { project } },
      observation: { required: [], optional: [], access: { status: "unverified" as const } },
    };
    reads.project = project;
    const released: Array<{ readonly kind: string }> = [];
    runtime.acquire.mockImplementation((descriptor: { readonly kind: string }) =>
      Effect.sync(() => ({
        leaseId: `lease:${descriptor.kind}`,
        interest: descriptor.kind,
        release: Effect.sync(() => released.push(descriptor)),
      })),
    );
    runtime.registry.get.mockImplementation((atom: unknown) =>
      atom === projectsAtom ? projects : reads.services,
    );
    runtime.registry.subscribe.mockImplementation(() => () => undefined);
    runtime.binding = {
      account: { account, epoch: 0 },
      runtime: {
        stateAtom,
        reads: {
          projectsOf: () => projectsAtom,
          servicesOf: () => servicesAtom,
        },
        acquire: runtime.acquire,
        refresh: runtime.refresh,
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
      "organization-inventory",
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

  it("reads the organizations again on refresh, keeping every lease", async () => {
    render();
    await settle();

    render().refresh();
    await settle();

    expect(runtime.refresh).toHaveBeenCalledTimes(1);
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
});
