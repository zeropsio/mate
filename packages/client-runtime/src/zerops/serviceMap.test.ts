import { describe, expect, it } from "@effect/vitest";
import type { ZeropsLifecycle } from "@t3tools/contracts";

import { buildZeropsServiceMap, serviceStatusTone } from "./serviceMap.ts";
import type { ZeropsTopologyService, ZeropsTopologyView } from "./topology.ts";

const service = (
  overrides: Partial<ZeropsTopologyService> & { hostname: string },
): ZeropsTopologyService => ({
  serviceId: `svc-${overrides.hostname}`,
  type: "ubuntu/nodejs@22",
  status: "ACTIVE",
  group: "runtimes",
  transient: false,
  ports: [],
  ...overrides,
});

const topology = (
  services: ReadonlyArray<ZeropsTopologyService>,
  overrides?: Partial<ZeropsTopologyView>,
): ZeropsTopologyView => ({
  project: { id: "nTV3oMB2SS634ImDJnQckg", name: "z3-eval", status: "ACTIVE" },
  services,
  warnings: [],
  ...overrides,
});

/** The `z3-eval` project's real six non-system services, grouped as `topology.test.ts` proves. */
const realServices: ReadonlyArray<ZeropsTopologyService> = [
  service({ hostname: "s6fix1" }),
  service({
    hostname: "s6db",
    type: "valkey:single@7.2",
    group: "data",
  }),
  service({ hostname: "s6fix2" }),
  service({
    hostname: "zcp",
    type: "zcp@1",
    group: "infrastructure",
    subdomainUrl: "https://zcp-26a7-8080.prg1.zerops.app",
  }),
];

const lifecycle = (overrides: Partial<ZeropsLifecycle>): ZeropsLifecycle =>
  ({ threadId: "thread-1", recentTools: [], ...overrides }) as unknown as ZeropsLifecycle;

describe("serviceStatusTone", () => {
  it.each([
    ["FAILED", false, "error"],
    ["ACTION_FAILED", false, "error"],
    ["CONTAINER_FAILED", false, "error"],
    ["REPAIR_FAILED", false, "error"],
    ["CREATING", true, "warning"],
    ["ACTIVE", false, "outline"],
  ] as const)("maps %s (transient=%s) to %s", (status, transient, tone) => {
    expect(serviceStatusTone(service({ hostname: "app", status, transient }))).toBe(tone);
  });
});

describe("buildZeropsServiceMap", () => {
  it("orders the groups runtimes, data, infrastructure", () => {
    const view = buildZeropsServiceMap(topology(realServices));

    expect(view?.groups.map((group) => group.group)).toEqual([
      "runtimes",
      "data",
      "infrastructure",
    ]);
    expect(view?.groups.map((group) => group.rows.map((row) => row.service.hostname))).toEqual([
      ["s6fix1", "s6fix2"],
      ["s6db"],
      ["zcp"],
    ]);
  });

  it("omits a group with no services rather than showing it empty", () => {
    const view = buildZeropsServiceMap(topology([realServices[3]!]));

    expect(view?.groups.map((group) => group.group)).toEqual(["infrastructure"]);
  });

  /**
   * Types carry an OS prefix (`ubuntu/nodejs@22`). The runtime is what a reader
   * is looking for; the base image is noise in a one-line row.
   */
  it("strips the OS prefix from the type label", () => {
    const view = buildZeropsServiceMap(
      topology([
        service({ hostname: "app" }),
        service({ hostname: "db", type: "postgresql:single@18", group: "data" }),
        service({ hostname: "zcp", type: "zcp@1", group: "infrastructure" }),
      ]),
    );
    const labels = view?.groups.flatMap((group) => group.rows.map((row) => row.typeLabel));

    expect(labels).toEqual(["nodejs@22", "postgresql:single@18", "zcp@1"]);
  });

  it("folds a stage service into its dev row", () => {
    const view = buildZeropsServiceMap(
      topology([
        service({ hostname: "kanbandev" }),
        service({ hostname: "kanbanstage", status: "CREATING", transient: true }),
      ]),
    );
    const rows = view?.groups[0]?.rows ?? [];

    expect(rows).toHaveLength(1);
    expect(rows[0]?.service.hostname).toBe("kanbandev");
    expect(rows[0]?.stage?.hostname).toBe("kanbanstage");
    expect(rows[0]?.stage?.transient).toBe(true);
  });

  it("leaves a stage service standing alone when it has no dev partner", () => {
    const view = buildZeropsServiceMap(topology([service({ hostname: "orphanstage" })]));
    const rows = view?.groups[0]?.rows ?? [];

    expect(rows).toHaveLength(1);
    expect(rows[0]?.service.hostname).toBe("orphanstage");
    expect(rows[0]?.stage).toBeUndefined();
  });

  it("does not pair across groups", () => {
    const view = buildZeropsServiceMap(
      topology([
        service({ hostname: "cachedev" }),
        service({ hostname: "cachestage", group: "data" }),
      ]),
    );

    expect(view?.groups.flatMap((group) => group.rows.map((row) => row.service.hostname))).toEqual([
      "cachedev",
      "cachestage",
    ]);
  });

  it("offers Open only where the feed carries a subdomain URL", () => {
    const view = buildZeropsServiceMap(topology(realServices));
    const open = view?.groups.flatMap((group) =>
      group.rows.map((row) => [row.service.hostname, row.service.subdomainUrl] as const),
    );

    expect(open).toEqual([
      ["s6fix1", undefined],
      ["s6fix2", undefined],
      ["s6db", undefined],
      ["zcp", "https://zcp-26a7-8080.prg1.zerops.app"],
    ]);
  });

  it("says so when there are no services yet", () => {
    const view = buildZeropsServiceMap(topology([]));

    expect(view?.isEmpty).toBe(true);
    expect(view?.groups).toEqual([]);
  });

  /** No view yet — no session, no resolved project, or the first read still pending. */
  it("renders nothing at all when there is no topology view", () => {
    expect(buildZeropsServiceMap(undefined)).toBeUndefined();
  });

  it("carries the projection's warnings through opaquely", () => {
    const view = buildZeropsServiceMap(topology(realServices, { warnings: ["something to say"] }));

    expect(view?.warnings).toEqual(["something to say"]);
  });

  /**
   * The topology projection carries no live process state beyond `transient`
   * — so a running tool is the only signal that something is happening right
   * now. It belongs to the map, not to a row: `ZeropsRecentTool` has no
   * hostname, and guessing one would be a lie.
   */
  it("surfaces a running zerops tool as the map's live indicator", () => {
    const view = buildZeropsServiceMap(
      topology(realServices),
      lifecycle({
        recentTools: [
          {
            toolName: "zerops_deploy",
            status: "inProgress",
            at: "2026-08-28T10:00:00Z",
            itemId: "item-1",
          },
          {
            toolName: "zerops_mount",
            status: "completed",
            at: "2026-08-28T09:00:00Z",
            itemId: "item-0",
          },
        ],
      } as unknown as Partial<ZeropsLifecycle>),
    );

    expect(view?.runningTool).toBe("zerops_deploy");
  });

  it("has no live indicator when every recent tool has finished", () => {
    const view = buildZeropsServiceMap(
      topology(realServices),
      lifecycle({
        recentTools: [
          {
            toolName: "zerops_deploy",
            status: "completed",
            at: "2026-08-28T10:00:00Z",
            itemId: "item-1",
          },
        ],
      } as unknown as Partial<ZeropsLifecycle>),
    );

    expect(view?.runningTool).toBeUndefined();
  });

  /**
   * The envelope renders each production launch as `"<name> (<projectId>)"`
   * (`zcp internal/workflow/compute_envelope.go` `prodLaunchRefsRender`). The
   * id is what makes it a link; a string that does not match still renders as
   * a label, because a production launch the client cannot parse is still worth
   * telling the user about.
   */
  it("turns a production launch into a project link", () => {
    const view = buildZeropsServiceMap(
      topology([service({ hostname: "kanbandev" })]),
      lifecycle({
        envelope: {
          services: [
            {
              hostname: "kanbandev",
              feedsProduction: ["kanban-prod (aBcD1234EfGh)", "malformed entry"],
            },
          ],
        },
      } as unknown as Partial<ZeropsLifecycle>),
    );
    const production = view?.groups[0]?.rows[0]?.production ?? [];

    expect(production).toEqual([
      {
        label: "kanban-prod",
        projectId: "aBcD1234EfGh",
        url: "https://app.zerops.io/project/aBcD1234EfGh",
      },
      { label: "malformed entry" },
    ]);
  });

  it("has no production links when the envelope carries none", () => {
    const view = buildZeropsServiceMap(
      topology([service({ hostname: "kanbandev" })]),
      lifecycle({}),
    );

    expect(view?.groups[0]?.rows[0]?.production).toEqual([]);
  });
});
