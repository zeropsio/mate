import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import { reactHookHarness as hooks } from "../../../../web/src/test/reactHookHarness";

interface TestBinding {
  readonly released: Array<{ readonly kind: string }>;
  readonly projectAtom: unknown;
  readonly serviceAtom: unknown;
  readonly stateAtom: unknown;
}

const effects = vi.hoisted(() => [] as Array<() => void | (() => void)>);
const runtime = vi.hoisted(() => ({
  binding: null as TestBinding | null,
  acquire: vi.fn(),
  registry: {
    get: vi.fn(),
    subscribe: vi.fn(),
  },
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
    useEffect: (effect: () => void | (() => void)) => {
      effects.push(effect);
    },
    useMemo: reactHookHarness.useMemo,
    useState: reactHookHarness.useState,
  };
});

const candidateProjection = vi.hoisted(
  () =>
    ({ override: null }) as {
      override: ((...args: Array<unknown>) => unknown) | null;
    },
);
vi.mock("@t3tools/client-runtime/zerops/candidateLoading", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@t3tools/client-runtime/zerops/candidateLoading")>();
  return {
    ...actual,
    projectZeropsCandidates: (...args: Array<unknown>) =>
      candidateProjection.override
        ? candidateProjection.override(...args)
        : (actual.projectZeropsCandidates as (...args: Array<unknown>) => unknown)(...args),
  };
});

const health = vi.hoisted(() => ({ probe: vi.fn() }));
vi.mock("./candidate-loading", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./candidate-loading")>();
  return {
    ...actual,
    probeCandidateHealthBatch: (...args: Parameters<typeof actual.probeCandidateHealthBatch>) =>
      health.probe(...args),
  };
});

vi.mock("../../state/environments", () => ({ useEnvironments: () => ({ environments: [] }) }));
vi.mock("./ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({ status: "signed-in", organizations: [{ id: "org-a" }] }),
}));
vi.mock("./ZeropsDataProvider", () => ({
  useZeropsData: () => ({ binding: runtime.binding, error: null }),
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

import { connectedZeropsOrigins } from "./candidate-origins";
import { useZeropsCandidates } from "./useZeropsCandidates";
import * as Effect from "effect/Effect";
import {
  makeZeropsApiOrigin,
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
} from "@t3tools/client-runtime/zerops/data";

it("indexes only connected Zerops origins", () => {
  const connected = EnvironmentId.make("connected");
  const origins = connectedZeropsOrigins([
    {
      environmentId: connected,
      displayUrl: "https://ZCP-DEMO-8080.PRG1.ZEROPS.APP/mate/",
      connection: { phase: "connected" },
    },
    {
      environmentId: EnvironmentId.make("offline"),
      displayUrl: "https://offline.example.test/mate",
      connection: { phase: "offline" },
    },
  ]);

  expect(origins).toEqual(new Map([["https://zcp-demo-8080.prg1.zerops.app", connected]]));
});

async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

describe("candidate topology demand", () => {
  beforeEach(() => {
    hooks.reset();
    effects.length = 0;
    runtime.acquire.mockReset();
    runtime.registry.get.mockReset();
    runtime.registry.subscribe.mockReset();
    scopes.reset();
    candidateProjection.override = null;
    health.probe.mockReset().mockResolvedValue([]);

    const account = {
      apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
      accountId: ZeropsAccountId.make("account-a"),
    };
    const project = {
      kind: "project" as const,
      organization: {
        kind: "organization" as const,
        account,
        organizationId: ZeropsOrganizationId.make("org-a"),
      },
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
      query: { status: "observed" as const },
      observation: {},
    };
    const services = { value: [], query: { status: "unresolved" as const }, observation: {} };
    const released: Array<{ readonly kind: string }> = [];
    runtime.acquire.mockImplementation((descriptor: { readonly kind: string }) =>
      Effect.sync(() => ({
        leaseId: `lease:${descriptor.kind}`,
        interest: descriptor.kind,
        release: Effect.sync(() => released.push(descriptor)),
      })),
    );
    runtime.registry.get.mockImplementation((atom: unknown) =>
      atom === projectsAtom ? projects : services,
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
      },
      registry: runtime.registry,
      released,
      projectAtom: projectsAtom,
      serviceAtom: servicesAtom,
      stateAtom,
    } as TestBinding;
  });

  it("subscribes only to project/service projections and releases active topology on cleanup", async () => {
    hooks.beginRender();
    useZeropsCandidates();
    const cleanup = effects[0]?.() as () => void;
    await settle();

    expect(runtime.acquire.mock.calls.map(([descriptor]) => descriptor.kind)).toEqual([
      "organization-inventory",
      "project-inventory",
    ]);
    const subscriptions = runtime.registry.subscribe.mock.calls;
    expect(subscriptions.map(([atom]) => atom)).toContain(runtime.binding?.projectAtom);
    expect(subscriptions.map(([atom]) => atom)).toContain(runtime.binding?.serviceAtom);
    expect(subscriptions.map(([atom]) => atom)).not.toContain(runtime.binding?.stateAtom);

    runtime.registry.get.mockClear();
    const projectListener = subscriptions.find(
      ([atom]) => atom === runtime.binding?.projectAtom,
    )?.[1] as (() => void) | undefined;
    const serviceListener = subscriptions.find(
      ([atom]) => atom === runtime.binding?.serviceAtom,
    )?.[1] as (() => void) | undefined;
    projectListener?.();
    expect(runtime.registry.get).toHaveBeenCalledWith(runtime.binding?.projectAtom);
    serviceListener?.();
    expect(runtime.registry.get).toHaveBeenCalledWith(runtime.binding?.serviceAtom);

    cleanup();
    await settle();
    expect(runtime.binding?.released.map((descriptor) => descriptor.kind)).toContain(
      "project-inventory",
    );
  });

  it("closes a scope created after cleanup without acquiring any interest", async () => {
    scopes.defer();
    hooks.beginRender();
    useZeropsCandidates();
    const cleanup = effects[0]?.() as () => void;

    cleanup();
    scopes.resolve();
    await scopes.waitForClose();

    expect(runtime.acquire).not.toHaveBeenCalled();
    expect(scopes.closeCalls).toHaveLength(1);
  });

  it("surfaces a rejected project-inventory acquire as an error and clears it on retry", async () => {
    const projectInventoryError = new Error("project inventory denied");
    runtime.acquire.mockImplementation((descriptor: { readonly kind: string }) =>
      descriptor.kind === "project-inventory"
        ? Effect.fail(projectInventoryError)
        : Effect.sync(() => ({
            leaseId: `lease:${descriptor.kind}`,
            interest: descriptor.kind,
            release: Effect.sync(() => undefined),
          })),
    );

    let renderState: ReturnType<typeof useZeropsCandidates> | undefined;
    hooks.beginRender();
    renderState = useZeropsCandidates();
    effects[0]?.();
    await settle();

    hooks.beginRender();
    renderState = useZeropsCandidates();
    expect(renderState.error).toBe("project inventory denied");
    expect(renderState.isLoading).toBe(false);

    runtime.acquire.mockImplementation((descriptor: { readonly kind: string }) =>
      Effect.sync(() => ({
        leaseId: `lease:${descriptor.kind}`,
        interest: descriptor.kind,
        release: Effect.sync(() => undefined),
      })),
    );
    const projectListener = runtime.registry.subscribe.mock.calls.find(
      ([atom]) => atom === runtime.binding?.projectAtom,
    )?.[1] as (() => void) | undefined;
    projectListener?.();
    await settle();

    hooks.beginRender();
    renderState = useZeropsCandidates();
    expect(renderState.error).toBeNull();
  });

  it("re-probes container health only when the set of ready origins changes", async () => {
    const readyCandidate = (origin: string) => ({
      key: `project-a:${origin}`,
      project: { id: "project-a", name: "Demo", status: "ACTIVE" as const },
      service: { id: origin, name: "zcp", status: "ACTIVE" as const },
      containerOrigin: origin,
      group: "ready" as const,
    });
    let candidates = [readyCandidate("https://a.example.test")];
    candidateProjection.override = (projects: unknown) => ({
      projects,
      candidates,
      unresolvedProjects: [],
      unresolvedServiceProjects: [],
    });

    hooks.beginRender();
    useZeropsCandidates();
    effects[0]?.();
    await settle();
    expect(health.probe).toHaveBeenCalledTimes(1);

    const projectListener = runtime.registry.subscribe.mock.calls.find(
      ([atom]) => atom === runtime.binding?.projectAtom,
    )?.[1] as (() => void) | undefined;

    // Same ready-origin set: republishing must not re-probe.
    projectListener?.();
    await settle();
    expect(health.probe).toHaveBeenCalledTimes(1);

    // A different ready-origin set is a reason to probe again.
    candidates = [readyCandidate("https://b.example.test")];
    projectListener?.();
    await settle();
    expect(health.probe).toHaveBeenCalledTimes(2);
  });
});
