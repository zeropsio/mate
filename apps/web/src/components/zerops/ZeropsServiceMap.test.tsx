import type { ZeropsLifecycle } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import type { Known } from "@t3tools/client-runtime/zerops/knowledge";
import {
  buildZeropsServiceMap,
  type ZeropsCrewPortOwners,
} from "@t3tools/client-runtime/zerops/serviceMap";
import type {
  ZeropsTopologyService,
  ZeropsTopologyView,
} from "@t3tools/client-runtime/zerops/topology";
import liveThreeServersFixture from "../../../../../packages/client-runtime/src/zerops/model/builders/__fixtures__/dev-server.live-three-servers.json" with { type: "json" };
import { ZeropsDataLinkContext } from "./dataLink";
import { ZeropsServiceDetail, ZeropsServiceMap, type ZeropsMateOnMap } from "./ZeropsServiceMap";

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
  project: { id: "proj-1", name: "z3-eval", status: "ACTIVE" },
  services,
  warnings: [],
  usageRead: false,
  ...overrides,
});

const usage = {
  containers: 1,
  cores: { used: 0.076, limit: 2 },
  memoryGb: { used: 0.512, limit: 2.625 },
  diskGb: { used: 0.161, limit: 2 },
};

/** A lifecycle snapshot as the feed's live answer. */
const liveLifecycle = (value: ZeropsLifecycle): Known<ZeropsLifecycle> => ({
  state: "known",
  value,
  asOf: { ordinal: 1, atMs: 0 },
  coverage: "complete",
  freshness: { kind: "live" },
});

const render = (
  view: ZeropsTopologyView | undefined,
  options?: {
    readonly lifecycle?: ZeropsLifecycle;
    readonly liveness?: "live" | "recovering";
    readonly error?: string;
    readonly runningTool?: string;
    readonly mate?: ZeropsMateOnMap;
    readonly mateUpdate?: ReactNode;
    readonly agents?: ReactNode;
    readonly currentServiceId?: string;
    readonly crewPorts?: ZeropsCrewPortOwners;
  },
): string =>
  renderToStaticMarkup(
    <ZeropsServiceMap
      mateUpdate={options?.mateUpdate}
      currentServiceId={options?.currentServiceId}
      agents={options?.agents}
      error={options?.error}
      liveness={options?.liveness}
      mate={options?.mate}
      view={buildZeropsServiceMap(
        view,
        options?.lifecycle === undefined ? undefined : liveLifecycle(options.lifecycle),
        options?.runningTool,
        options?.crewPorts,
      )}
    />,
  );

/** The pop's body for the first row of the first group. */
const renderDetail = (view: ZeropsTopologyView, lifecycle?: ZeropsLifecycle): string => {
  const row = buildZeropsServiceMap(
    view,
    lifecycle === undefined ? undefined : liveLifecycle(lifecycle),
  )?.groups[0]?.rows[0];
  expect(row).toBeDefined();
  return renderToStaticMarkup(<ZeropsServiceDetail row={row!} />);
};

const liveThreeServers: { envelope: unknown } = liveThreeServersFixture;

describe("ZeropsServiceMap — the card", () => {
  it("a dev row names each dev server zcp read, with its port and state", () => {
    const html = render(topology([service({ hostname: "e1pnpm" })]), {
      lifecycle: { envelope: liveThreeServers.envelope } as unknown as ZeropsLifecycle,
    });
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(html).toContain("data-zerops-service-devservers");
    for (const named of ["web :3000", "api :8080", "worker"]) expect(text).toContain(named);
    expect(html.match(/data-zerops-service-devserver="/g)).toHaveLength(3);
  });

  it("a one-part dev row names no dev server: its hostname is already its name", () => {
    const envelope = JSON.parse(JSON.stringify(liveThreeServers.envelope)) as {
      services: Array<{ devServers: Array<{ name: string }> }>;
    };
    envelope.services[0]!.devServers = [{ name: "e1pnpm" }];
    const html = render(topology([service({ hostname: "e1pnpm" })]), {
      lifecycle: { envelope } as unknown as ZeropsLifecycle,
    });
    expect(html).not.toContain("data-zerops-service-devserver");
  });

  it("draws a Data button on data-group cards only, and only when an opener is in context", () => {
    const view = topology([
      service({ hostname: "app", group: "runtimes" }),
      service({ hostname: "db", type: "postgresql:single@18", group: "data" }),
    ]);
    const withOpener = renderToStaticMarkup(
      <ZeropsDataLinkContext value={() => undefined}>
        <ZeropsServiceMap view={buildZeropsServiceMap(view, undefined, undefined)} />
      </ZeropsDataLinkContext>,
    );
    expect(withOpener.match(/data-zerops-service-data-button/g)).toHaveLength(1);
    expect(withOpener).toContain('aria-label="Browse data of db"');
    expect(render(view)).not.toContain("data-zerops-service-data-button");
  });

  it("shows a stage service nested under its dev partner", () => {
    const html = render(
      topology([
        service({ hostname: "kanbandev" }),
        service({ hostname: "kanbanstage", status: "CREATING", transient: true }),
      ]),
    );

    expect(html).toContain(">kanbandev<");
    expect(html).toContain("data-zerops-service-stage");
    expect(html).toContain(">kanbanstage<");
    expect(html).toContain("Creating");
    expect(html.match(/data-zerops-service-row=/gu)).toHaveLength(1);
  });

  it("a Mate's service shows its real hostname: a pair's nested half by its own, never a made-up name or the word stage", () => {
    const html = render(
      topology([service({ hostname: "kanbandev" }), service({ hostname: "kanbanstage" })]),
    );
    expect(html).toContain(">kanbanstage<");
    expect(html).not.toContain(">Preview<");
    expect(html).not.toContain("<span>stage</span>");
  });

  it("names a running tool as a phrase, not a spinner", () => {
    const html = render(topology([service({ hostname: "kanbandev" })]), {
      runningTool: "zerops_deploy",
    });

    expect(html).toContain('data-zerops-running-tool="zerops_deploy"');
    expect(html).toContain("zerops_deploy running");
  });

  it("says there is nothing yet rather than showing empty groups", () => {
    const html = render(topology([]));

    expect(html).toContain("No services yet");
    expect(html).not.toContain("Runtimes");
  });

  /** No view yet — no session, no resolved project, or the first read still pending. */
  it("renders nothing at all when there is no view", () => {
    expect(render(undefined)).toBe("");
  });

  it("flags the last failed read quietly, keeping the last good rows", () => {
    const html = render(topology([service({ hostname: "kanbandev" })]), {
      error: "Network error contacting Zerops.",
    });

    expect(html).toContain("data-zerops-map-degraded");
    expect(html).toContain("Network error contacting Zerops.");
    expect(html).toContain("kanbandev");
  });

  it("carries the projection's warnings through opaquely", () => {
    const html = render(
      topology([service({ hostname: "s6fix1" })], {
        warnings: ["2 services can be adopted: s6fix1, s6fix2"],
      }),
    );

    expect(html).toContain("2 services can be adopted");
  });
});

describe("ZeropsServiceMap — the control plane is the Mate's home", () => {
  const zcp = service({
    hostname: "zcp",
    type: "ubuntu/zcp@1",
    group: "infrastructure",
    ports: [{ port: 8080, scheme: "http" }],
  });
  const fen: ZeropsMateOnMap = { name: "Fen", tint: "coral", face: "working" };

  it("says who lives in the control plane, the face wearing the conversation's state", () => {
    const html = render(topology([service({ hostname: "app" }), zcp]), {
      mate: fen,
      currentServiceId: zcp.serviceId,
    });

    const home = html.slice(html.indexOf('data-zerops-service-row="control-plane"'));
    expect(home).toContain("data-zerops-mate-home");
    expect(home).toContain('data-mate-face-tint="coral"');
    expect(home).toContain('data-mate-face-state="working"');
    expect(home).toMatch(/>Fen<\/span><span[^>]*> lives here<\/span>/u);
    // Fen lives in the control plane, not in the app.
    expect(html.match(/data-zerops-mate-home/gu)).toHaveLength(1);
    expect(html.indexOf("data-zerops-mate-home")).toBeGreaterThan(
      html.indexOf("Zerops Control Plane"),
    );
  });

  it.each(["svc-zcp", "svc-probe", "missing", undefined])(
    "attaches the current environment only to its service ID: %s",
    (currentServiceId) => {
      const probe = service({ hostname: "probe", type: "ubuntu/zcp@1", group: "infrastructure" });
      const html = render(topology([zcp, probe]), {
        mate: fen,
        agents: <div data-test-agents="true">agents</div>,
        ...(currentServiceId === undefined ? {} : { currentServiceId }),
      });
      expect(html.match(/data-zerops-service-row="control-plane"/gu)).toHaveLength(2);
      // A control plane nobody is known to live in goes by its hostname.
      if (currentServiceId !== zcp.serviceId) expect(html).toContain(">zcp<");
      if (currentServiceId !== probe.serviceId) expect(html).toContain(">probe<");
      const matched = currentServiceId === zcp.serviceId || currentServiceId === probe.serviceId;
      expect(html.match(/data-zerops-mate-home/gu) ?? []).toHaveLength(matched ? 1 : 0);
      expect(html.match(/data-test-agents/gu) ?? []).toHaveLength(matched ? 1 : 0);
      if (matched) {
        const ownerStart = html.indexOf(`data-zerops-service-id="${currentServiceId}"`);
        const owner = html.slice(ownerStart, html.indexOf("</li>", ownerStart));
        expect(owner).toContain("data-zerops-mate-home");
        expect(owner).toContain("data-test-agents");
      }
    },
  );

  it("calls the Mate's home Zerops Control Plane and its Mate's, never by its hostname", () => {
    const html = render(topology([service({ hostname: "app" }), zcp]), {
      mate: fen,
      currentServiceId: zcp.serviceId,
    });
    const home = html.slice(html.indexOf('data-zerops-service-row="control-plane"'));
    expect(home).toContain("Zerops Control Plane");
    expect(home).not.toContain(">zcp<");
  });

  it("says nothing about a Mate when nobody is known to live here", () => {
    const html = render(topology([zcp]));

    expect(html).not.toContain("data-zerops-mate-home");
    expect(html).not.toContain("lives here");
  });

  it("hangs the agents card from the control-plane card, outside its hover pop", () => {
    const html = render(topology([service({ hostname: "app" }), zcp]), {
      mate: fen,
      currentServiceId: zcp.serviceId,
      agents: <div data-test-agents="true">agents</div>,
    });

    const rowAt = html.indexOf('data-zerops-service-row="control-plane"');
    const rowEnd = html.indexOf("</li>", rowAt);
    const row = html.slice(rowAt, rowEnd);
    const mintAt = row.indexOf('data-zerops-primitive="mint-panel"');
    const mintEnd = row.indexOf("</section>", mintAt);
    const trayAt = row.indexOf("data-zerops-agent-auth-tray");
    expect(trayAt).toBeGreaterThan(mintEnd);
    expect(row).toContain('data-test-agents="true"');
    // The Mate line is the last thing in the mint before the card grows out of it.
    expect(row.indexOf("data-zerops-mate-home")).toBeLessThan(mintEnd);
    expect(html.match(/data-zerops-agent-auth-tray/gu)).toHaveLength(1);
  });

  it("keeps the Mate's version and its update under its home, outside the hover pop", () => {
    const html = render(topology([service({ hostname: "app" }), zcp]), {
      mate: fen,
      currentServiceId: zcp.serviceId,
      mateUpdate: <span data-test-update="true">Server 0.11.43 · 0.11.47 available</span>,
    });

    const rowAt = html.indexOf('data-zerops-service-row="control-plane"');
    const row = html.slice(rowAt, html.indexOf("</li>", rowAt));
    // The hover pop's trigger is the card's text: the first div in the mint.
    const mintAt = row.indexOf('data-zerops-primitive="mint-panel"');
    const triggerAt = row.indexOf("<div", mintAt);
    let depth = 0;
    let triggerEnd = -1;
    for (const match of row.slice(triggerAt).matchAll(/<div\b|<\/div>/gu)) {
      depth += match[0] === "</div>" ? -1 : 1;
      if (depth === 0) {
        triggerEnd = triggerAt + match.index;
        break;
      }
    }
    const updateAt = row.indexOf("data-zerops-mate-update");
    expect(row.indexOf("lives here")).toBeLessThan(triggerEnd);
    expect(updateAt).toBeGreaterThan(triggerEnd);
    expect(updateAt).toBeLessThan(row.indexOf("</section>", mintAt));
    expect(row).toContain('data-test-update="true"');
  });

  it("says no version where nobody is known to live", () => {
    const html = render(topology([zcp]), {
      mateUpdate: <span data-test-update="true">Server 0.11.43</span>,
    });

    expect(html).not.toContain("data-zerops-mate-update");
  });

  it("hangs nothing when there is no agents card", () => {
    const html = render(topology([zcp]), { mate: fen, currentServiceId: zcp.serviceId });

    expect(html).not.toContain("data-zerops-agent-auth-tray");
  });
});

describe("ZeropsServiceDetail — the pop", () => {
  it("links the name to the service's page in the Zerops dashboard", () => {
    const html = renderDetail(topology([service({ hostname: "kanbandev", serviceId: "svc-1" })]));

    expect(html).toContain("data-zerops-service-dashboard");
    expect(html).toContain('href="https://app.zerops.io/service-stack/svc-1"');
  });

  it("says what the service is and how it was deployed in one meta line", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-01T09:30:34Z"));
    try {
      const html = renderDetail(
        topology([
          service({
            hostname: "app",
            typeName: "Node.js",
            version: "v22.22.3",
            deploy: { source: "CLI", activatedAt: "2026-09-01T08:30:34Z" },
          }),
        ]),
      );

      expect(html).toContain("data-zerops-service-meta");
      expect(html).toContain("Node.js v22.22.3 · Deployed from CLI 1h ago");
    } finally {
      now.mockRestore();
    }
  });

  it("puts the hostname and port first in the control plane's meta line", () => {
    const html = renderDetail(
      topology([
        service({
          hostname: "zcp",
          type: "zcp@1",
          group: "infrastructure",
          ports: [{ port: 8080, scheme: "http" }],
        }),
      ]),
    );

    expect(html).toContain("Zerops Control Plane");
    expect(html).toContain("zcp:8080 · zcp@1");
  });

  it("lists every public route as its host, a link", () => {
    const html = renderDetail(
      topology([
        service({
          hostname: "kanbandev",
          routes: [
            {
              port: 80,
              url: "https://kanbandev-26a7.prg1.zerops.app",
              host: "kanbandev-26a7.prg1.zerops.app",
            },
            {
              port: 3000,
              url: "https://kanbandev-26a7-3000.prg1.zerops.app",
              host: "kanbandev-26a7-3000.prg1.zerops.app",
            },
          ],
        }),
      ]),
    );

    expect(html).toContain("data-zerops-service-routes");
    expect(html).toContain('href="https://kanbandev-26a7.prg1.zerops.app"');
    expect(html).toContain('href="https://kanbandev-26a7-3000.prg1.zerops.app"');
    expect(html).toContain("kanbandev-26a7-3000.prg1.zerops.app</span>");
  });

  it("names a stage partner's routes as its stage's, never as the dev service's own", () => {
    const html = renderDetail(
      topology([
        service({
          hostname: "appdev",
          routes: [
            {
              port: 3000,
              url: "https://appdev-1-3000.zerops.app",
              host: "appdev-1-3000.zerops.app",
            },
          ],
        }),
        service({
          hostname: "appstage",
          routes: [
            {
              port: 3000,
              url: "https://appstage-1-3000.zerops.app",
              host: "appstage-1-3000.zerops.app",
            },
          ],
        }),
      ]),
    );

    expect(html).toContain("appdev-1-3000.zerops.app</span>");
    expect(html).toContain("appstage · appstage-1-3000.zerops.app</span>");
  });

  it("offers a production project as a linked route", () => {
    const lifecycle = {
      threadId: "thread-1",
      envelope: {
        services: [{ hostname: "kanbandev", feedsProduction: ["Acme (proj-1)"] }],
      },
    } as unknown as ZeropsLifecycle;
    const html = renderDetail(topology([service({ hostname: "kanbandev" })]), lifecycle);

    expect(html).toContain("Production · Acme");
    expect(html).toContain('href="https://app.zerops.io/project/proj-1"');
  });

  it("shows used against allocated for each figure, with a fill", () => {
    const html = renderDetail(topology([service({ hostname: "app", usage })], { usageRead: true }));

    expect(html).toContain("data-zerops-service-metrics");
    expect(html).toContain('data-zerops-service-metric="containers"');
    expect(html).toContain('data-zerops-service-metric="memory"');
    expect(html).toContain("0.51");
    expect(html).toContain("2.63");
    expect(html).toContain('style="width:20%"');
  });

  it("has no figures for a service the topology knows only by type", () => {
    const html = renderDetail(topology([service({ hostname: "app" })]));

    expect(html).not.toContain("data-zerops-service-metrics");
  });

  const scaling = {
    containers: { min: 1, max: 3 },
    cores: { min: 1, max: 3 },
    memoryGb: { min: 0.125, max: 6 },
    diskGb: { min: 1, max: 100 },
    cpuMode: "SHARED",
  };

  it("shows the autoscaling range beside each figure, the cores' with the CPU mode", () => {
    const html = renderDetail(
      topology([service({ hostname: "app", usage, scaling })], { usageRead: true }),
    );

    expect(html.match(/data-zerops-service-metric-range/gu)).toHaveLength(4);
    expect(html).toContain("1 – 3");
    expect(html).toContain("0.13 – 6 GB");
    expect(html).toContain("1 – 100 GB");
    expect(html).toContain("1 – 3 · Shared");
  });

  it("shows the envelope alone for a service holding nothing yet", () => {
    const html = renderDetail(
      topology([service({ hostname: "app", status: "READY_TO_DEPLOY", scaling })], {
        usageRead: true,
      }),
    );

    expect(html).toContain("data-zerops-service-metrics");
    expect(html).toContain("1 – 3 · Shared");
    expect(html).not.toContain("data-zerops-service-metric-fill");
    expect(html).not.toContain(" / ");
  });
});

describe("ZeropsServiceMap — liveness", () => {
  it("shows connection recovery when the platform websocket is down", () => {
    const html = render(topology([service({ hostname: "kanbandev" })]), { liveness: "recovering" });

    expect(html).toContain('data-zerops-map-liveness="recovering"');
    expect(html).toContain("Connecting live updates");
    expect(html).not.toContain("polling");
    // Quiet, not alarming: this is not the last-read-failed banner.
    expect(html).not.toContain("data-zerops-map-degraded");
  });

  it("says nothing when the hook reports no liveness at all", () => {
    const html = render(topology([service({ hostname: "kanbandev" })]));

    expect(html).not.toContain("data-zerops-map-liveness");
  });

  it("shows the last-read-failed banner over liveness when both are present", () => {
    const html = render(topology([service({ hostname: "kanbandev" })]), {
      liveness: "live",
      error: "Network error contacting Zerops.",
    });

    expect(html).toContain("data-zerops-map-degraded");
    expect(html).not.toContain('data-zerops-map-liveness="live"');
  });
});

describe("ZeropsServiceMap — a pool-era Mate's parts", () => {
  const webpool = service({
    hostname: "webpool",
    type: "swarm@1",
    group: "infrastructure",
    ports: [{ port: 8101 }],
    routes: [
      { port: 8101, url: "https://webpool-8101.zerops.app", host: "webpool-8101.zerops.app" },
    ],
  });
  const leased = {
    threadId: "thread-1",
    recentTools: [],
    envelope: {
      services: [],
      leases: [
        {
          alias: "webpool-1",
          pool: "webpool",
          state: "held",
          devServers: [
            {
              name: "web",
              port: 3000,
              url: "https://webpool-1-3000.zerops.app",
              status: "running",
              readAt: "2026-10-28T10:00:00Z",
            },
          ],
        },
        {
          alias: "webpool-2",
          pool: "webpool",
          state: "held",
          devServers: [
            {
              name: "web",
              port: 3000,
              url: "https://webpool-2-3000.zerops.app",
              status: "crashed",
              readAt: "2026-10-28T10:00:00Z",
            },
          ],
        },
      ],
    },
  } as unknown as ZeropsLifecycle;

  it("the pool's pop opens each workspace by its chat and says why another has no link", () => {
    const row = buildZeropsServiceMap(
      topology([webpool]),
      liveLifecycle(leased),
      undefined,
      undefined,
      [{ title: "Fix the login form", alias: "webpool-1" }],
    )?.groups[0]?.rows[0];
    const html = renderToStaticMarkup(<ZeropsServiceDetail row={row!} />);

    expect(html).toContain("Fix the login form · webpool-1-3000.zerops.app</span>");
    expect(html).toContain("dev · stopped: crashed");
    expect(html).not.toContain("webpool-2-3000");
    expect(html).not.toContain("webpool-8101");
  });

  it("a holder's card says it holds the code and nothing runs there", () => {
    const html = render(
      topology([webpool, service({ hostname: "keeper", type: "ubuntu/go@1.22" })]),
      {
        lifecycle: {
          threadId: "thread-1",
          recentTools: [],
          envelope: {
            services: [
              {
                hostname: "keeper",
                typeVersion: "go@1.22",
                runtimeClass: "dynamic",
                standIn: { for: "pool-migrate" },
              },
            ],
          },
        } as unknown as ZeropsLifecycle,
      },
    );

    expect(html).toContain("Holds the code; nothing runs here");
  });
});
