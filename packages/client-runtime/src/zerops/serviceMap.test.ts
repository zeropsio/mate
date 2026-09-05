import { describe, expect, it } from "@effect/vitest";
import type { ZeropsLifecycle } from "@t3tools/contracts";

import {
  buildZeropsServiceMap,
  formatAmount,
  serviceStatusTone,
  zeropsPortLabel,
  zeropsServiceFacts,
  zeropsServiceMetrics,
  zeropsStatusWord,
} from "./serviceMap.ts";
import type { ZeropsTopologyService, ZeropsTopologyView } from "./topology.ts";

const service = (
  overrides: Partial<ZeropsTopologyService> & { hostname: string },
): ZeropsTopologyService => ({
  serviceId: `svc-${overrides.hostname}`,
  type: "ubuntu/nodejs@22",
  status: "ACTIVE",
  group: "runtimes",
  transient: false,
  routes: [],
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
  usageRead: false,
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
    ["RUNNING", false, "outline"],
    ["STOPPED", false, "muted"],
    ["SERVICE_STOPPED", false, "muted"],
    ["READY_TO_DEPLOY", false, "muted"],
    ["DELETED", false, "muted"],
    // In flight outranks settled-but-off: a stopping service is busy.
    ["STOPPED", true, "warning"],
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
   * now. It belongs to the map, not to a row: the caller passes it in from
   * `ZeropsThreadModel.running` (the one owner of "which call is running"),
   * never derived from `lifecycle.recentTools` here.
   */
  it("surfaces the caller's runningTool as the map's live indicator", () => {
    const view = buildZeropsServiceMap(topology(realServices), lifecycle({}), "zerops_deploy");

    expect(view?.runningTool).toBe("zerops_deploy");
  });

  it("has no live indicator when the caller passes none", () => {
    const view = buildZeropsServiceMap(topology(realServices), lifecycle({}));

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

describe("buildZeropsServiceMap — the row's identity", () => {
  const rowFor = (entry: ZeropsTopologyService) =>
    buildZeropsServiceMap(topology([entry]))?.groups[0]?.rows[0];

  it("names a service by its hostname, with its type-version as the one meta segment", () => {
    const row = rowFor(service({ hostname: "kanbandev" }));

    expect(row?.title).toBe("kanbandev");
    expect(row?.meta).toEqual([{ id: "type", label: "nodejs@22" }]);
    expect(row).not.toHaveProperty("portLabel");
  });

  it("shows the declared ports after the name", () => {
    const row = rowFor(
      service({
        hostname: "api",
        ports: [
          { port: 80, scheme: "http" },
          { port: 443, scheme: "https" },
        ],
      }),
    );

    expect(row?.portLabel).toBe(":80, :443");
  });

  it("names the control plane by its glossary word, hostname and port first in the meta line", () => {
    const row = rowFor(
      service({
        hostname: "zcp",
        type: "zcp@1",
        group: "infrastructure",
        typeName: "Zerops Control Plane",
        version: "v1",
        deploy: { source: "GIT" },
        ports: [{ port: 8080, scheme: "http" }],
      }),
    );

    expect(row?.title).toBe("Zerops Control Plane");
    expect(row).not.toHaveProperty("portLabel");
    expect(row?.meta).toEqual([
      { id: "hostname", label: "zcp:8080" },
      { id: "deploy", label: "Deployed from Git" },
    ]);
  });

  it("links every row to its own page in the Zerops dashboard", () => {
    const row = rowFor(service({ hostname: "kanbandev", serviceId: "EmWgeZ4rTiK0Ajpm8iH83A" }));

    expect(row?.dashboardUrl).toBe("https://app.zerops.io/service-stack/EmWgeZ4rTiK0Ajpm8iH83A");
  });

  it("carries the live strip once usage is known", () => {
    const row = rowFor(
      service({
        hostname: "app",
        usage: {
          containers: 1,
          cores: { used: 0.076, limit: 2 },
          memoryGb: { used: 0.512, limit: 2.625 },
          diskGb: { used: 0.161, limit: 2 },
        },
      }),
    );

    expect(row?.metrics.map((metric) => metric.id)).toEqual([
      "containers",
      "cores",
      "memory",
      "disk",
    ]);
  });
});

describe("zeropsStatusWord", () => {
  it.each([
    ["ACTIVE", "Active"],
    ["READY_TO_DEPLOY", "Ready to deploy"],
    ["CONTAINER_FAILED", "Container failed"],
    ["SOME_NEW_THING", "Some new thing"],
  ])("reads %s as %s", (status, word) => {
    expect(zeropsStatusWord(status)).toBe(word);
  });

  it("rides on the row", () => {
    const row = buildZeropsServiceMap(
      topology([service({ hostname: "app", status: "READY_TO_DEPLOY" })]),
    )?.groups[0]?.rows[0];

    expect(row?.statusLabel).toBe("Ready to deploy");
  });
});

describe("zeropsPortLabel", () => {
  it("is absent for a service with no ports", () => {
    expect(zeropsPortLabel(service({ hostname: "worker" }))).toBeUndefined();
  });
});

describe("formatAmount", () => {
  it.each([
    [2, "2"],
    [2.625, "2.63"],
    [0.5, "0.5"],
    [0.375, "0.38"],
    [0.10000000149011612, "0.1"],
    [100, "100"],
  ])("prints %s as %s", (value, expected) => {
    expect(formatAmount(value)).toBe(expected);
  });
});

describe("zeropsServiceMetrics", () => {
  it("lays a service's allocation out as the dashboard's strip, with how much is in use", () => {
    expect(
      zeropsServiceMetrics({
        containers: 1,
        cores: { used: 0.076, limit: 2 },
        memoryGb: { used: 0.512, limit: 2.625 },
        diskGb: { used: 0.161, limit: 2 },
      }),
    ).toEqual([
      { id: "containers", label: "container", value: "1" },
      { id: "cores", label: "Cores", value: "2", fraction: 0.038 },
      { id: "memory", label: "RAM", value: "2.63", unit: "GB", fraction: 0.512 / 2.625 },
      { id: "disk", label: "Disk", value: "2", unit: "GB", fraction: 0.0805 },
    ]);
  });

  it("pluralises the containers and clamps a fraction to one", () => {
    const metrics = zeropsServiceMetrics({
      containers: 3,
      cores: { used: 4, limit: 3 },
      memoryGb: { used: 0, limit: 0 },
      diskGb: { used: 1, limit: 3 },
    });

    expect(metrics[0]).toEqual({ id: "containers", label: "containers", value: "3" });
    expect(metrics[1]?.fraction).toBe(1);
    // Nothing to fill when the allocation is zero.
    expect(metrics[2]).not.toHaveProperty("fraction");
  });

  it("is empty when usage is unknown", () => {
    expect(zeropsServiceMetrics(undefined)).toEqual([]);
  });
});

describe("zeropsServiceFacts", () => {
  it("states the type by its display name and exact version", () => {
    const facts = zeropsServiceFacts(
      service({ hostname: "app", typeName: "Node.js", version: "v22.22.3" }),
    );

    expect(facts).toEqual([{ id: "type", label: "Node.js v22.22.3" }]);
  });

  it("states the type by its name alone when the version is unknown", () => {
    expect(zeropsServiceFacts(service({ hostname: "app", typeName: "Node.js" }))).toEqual([
      { id: "type", label: "Node.js" },
    ]);
  });

  it("falls back to the type-version when the platform gave no display name", () => {
    expect(zeropsServiceFacts(service({ hostname: "app", type: "ubuntu/go@1.22" }))).toEqual([
      { id: "type", label: "go@1.22" },
    ]);
  });

  it.each([
    ["CLI", "Deployed from CLI"],
    ["GIT", "Deployed from Git"],
    ["GITHUB", "Deployed from GitHub"],
    ["GITLAB", "Deployed from GitLab"],
    ["GUI", "Uploaded in the GUI"],
    ["SOMETHING_NEW", "Deployed"],
  ])("phrases a %s deploy as %s, dated at its activation", (source, label) => {
    const facts = zeropsServiceFacts(
      service({
        hostname: "app",
        typeName: "Node.js",
        deploy: { source, activatedAt: "2026-09-01T08:30:34Z" },
      }),
    );

    expect(facts[1]).toEqual({ id: "deploy", label, at: "2026-09-01T08:30:34Z" });
  });

  it("names the branch and short commit of a git deploy", () => {
    const facts = zeropsServiceFacts(
      service({
        hostname: "app",
        typeName: "Node.js",
        deploy: { source: "GITHUB", branch: "main", commit: "abc1234def5678" },
      }),
    );

    expect(facts[1]?.label).toBe("Deployed from GitHub · main@abc1234");
  });

  it("names a tag, or the version's own name, when there is no branch", () => {
    expect(
      zeropsServiceFacts(
        service({
          hostname: "app",
          typeName: "Node.js",
          deploy: { source: "GITHUB", tag: "v2.0.0" },
        }),
      )[1]?.label,
    ).toBe("Deployed from GitHub · v2.0.0");
    expect(
      zeropsServiceFacts(
        service({
          hostname: "app",
          typeName: "Node.js",
          deploy: { source: "CLI", name: "hotfix" },
        }),
      )[1]?.label,
    ).toBe("Deployed from CLI · hotfix");
  });

  it("does not repeat the row's title as a type fact", () => {
    const zcp = service({
      hostname: "zcp",
      type: "zcp@1",
      group: "infrastructure",
      typeName: "Zerops Control Plane",
      version: "v1",
      deploy: { source: "GIT" },
    });

    expect(zeropsServiceFacts(zcp, "Zerops Control Plane").map((fact) => fact.id)).toEqual([
      "deploy",
    ]);
  });
});
