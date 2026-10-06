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
  NOT_READ_SERVICES,
  projectProcessesAtom,
  projectServicesAtom,
  shownProjectsAtom,
  type ProjectProcesses,
  type ProjectServices,
  type ServiceValue,
} from "@t3tools/client-runtime/data";
import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";

const runtime = vi.hoisted(() => ({
  binding: null as unknown,
  retry: vi.fn(),
  registry: {
    get: vi.fn(),
    subscribe: vi.fn(),
  },
}));
const session = vi.hoisted(() => ({ status: "signed-in", activeId: "org-a" as string | null }));
const reads = vi.hoisted(() => ({
  services: null as unknown,
  processes: null as unknown,
}));
/** The account runtime's Mate environments, as the provider binds them after the first grant. */
const stage = vi.hoisted(() => ({
  machines: new Map() as ReadonlyMap<string, unknown>,
}));
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
import { zeropsCandidatePresentation } from "./presentation";
import { useZeropsCandidates } from "./useZeropsCandidates";

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

/** The project's zcp container, as the organization's services listing holds it, live. */
const zcp = (patch: Partial<ServiceValue>): ProjectServices => ({
  services: [
    {
      id: "service-a",
      projectId: "project-a",
      name: "zcp",
      status: "ACTIVE",
      serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
      ...patch,
    },
  ],
  live: true,
  reconnecting: false,
});

describe("the project picker's candidates", () => {
  beforeEach(() => {
    hooks.reset();
    runtime.retry.mockReset();
    runtime.registry.get.mockReset();
    runtime.registry.subscribe.mockReset();
    session.status = "signed-in";
    session.activeId = "org-a";
    stage.machines = new Map();

    const projectsAtom = shownProjectsAtom;
    const servicesAtom = projectServicesAtom("project-a");
    const activityAtom = projectProcessesAtom("project-a");
    // The organization's roster, as the account's store lists it.
    const projects = {
      orgId: "org-a",
      projects: [{ id: "project-a", name: "Demo", status: "ACTIVE" }],
      read: "read" as const,
      complete: true,
      live: true,
      reconnecting: false,
    };
    reads.services = NOT_READ_SERVICES;
    reads.processes = NOT_READ_PROCESSES;
    runtime.registry.get.mockImplementation((atom: unknown) =>
      atom === projectsAtom
        ? projects
        : atom === activityAtom
          ? reads.processes
          : atom === servicesAtom
            ? reads.services
            : undefined,
    );
    runtime.registry.subscribe.mockImplementation(() => () => undefined);
    runtime.binding = {
      accountData: { observation: { retry: runtime.retry } },
      registry: runtime.registry,
    };
  });

  it.each([null, "org-b"])(
    "reads the organization %s off the account's store alone",
    async (id) => {
      session.activeId = id;
      render();
      await settle();
      expect(runtime.registry.subscribe.mock.calls.map(([atom]) => atom)).toContain(
        shownProjectsAtom,
      );
    },
  );

  it("follows every active project's services, and lets them go when the account leaves", async () => {
    const unsubscribed: unknown[] = [];
    runtime.registry.subscribe.mockImplementation((atom: unknown) => () => unsubscribed.push(atom));
    render();
    await settle();

    const subscribed = runtime.registry.subscribe.mock.calls.map(([atom]) => atom);
    expect(subscribed).toContain(projectServicesAtom("project-a"));
    expect(subscribed).toContain(projectProcessesAtom("project-a"));

    session.status = "signed-out";
    expect(render().listing).toEqual({ state: "unread", waitingFor: null });
    await settle();
    expect(unsubscribed).toContain(projectServicesAtom("project-a"));
  });

  it("knows a project's container without the project being opened", async () => {
    reads.services = zcp({ subdomainAccess: true, ports: [{ port: 8080, httpSupport: true }] });
    render();
    await settle();
    const { listing } = render();
    expect(listing.state === "known" ? listing.value[0]?.key : undefined).toBe(
      "project-a:service-a",
    );
  });

  it("keeps the listing when a Mate connects", async () => {
    render();
    await settle();

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
    const { listing } = render();
    await settle();

    expect(listing.state).toBe("known");
  });

  it("asks the account's observation again on refresh", async () => {
    render();
    await settle();

    render().refresh();
    await settle();

    expect(runtime.retry).toHaveBeenCalledTimes(1);
  });

  it("gives a restarting Mate's row its container's verdict, never not-reachable", async () => {
    reads.services = zcp({ status: "RESTARTING" });
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
      reads.services = zcp({
        created: CREATED_AT,
        subdomainAccess: false,
        ports: [{ port: 8080, protocol: "TCP", scheme: "http", httpSupport: true }],
      });
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

      vi.advanceTimersByTime(afterMs);
      listenerOf(shownProjectsAtom)?.();
      await settle();
      const row = rowOf(render().listing);
      expect(row?.group).toBe(group);
      if (group === "provisioning") {
        expect(row?.reason ?? "").not.toMatch(/public access/i);
      }
    });
  });
});
