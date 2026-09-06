import type { ZeropsLifecycle } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { buildZeropsServiceMap } from "@t3tools/client-runtime/zerops/serviceMap";
import type {
  ZeropsTopologyService,
  ZeropsTopologyView,
} from "@t3tools/client-runtime/zerops/topology";
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

const history = [
  {
    at: "2026-09-05T01:00:00+02:00",
    containers: 0,
    cores: { used: 0, limit: 0 },
    memoryGb: { used: 0, limit: 0 },
    diskGb: { used: 0, limit: 0 },
  },
  {
    at: "2026-09-06T00:00:00+02:00",
    containers: 1,
    cores: { used: 0.076, limit: 2 },
    memoryGb: { used: 0.512, limit: 2.625 },
    diskGb: { used: 0.161, limit: 2 },
  },
];

const render = (
  view: ZeropsTopologyView | undefined,
  options?: {
    readonly lifecycle?: ZeropsLifecycle;
    readonly liveness?: "live" | "polling";
    readonly error?: string;
    readonly runningTool?: string;
    readonly mate?: ZeropsMateOnMap;
    readonly agents?: ReactNode;
  },
): string =>
  renderToStaticMarkup(
    <ZeropsServiceMap
      agents={options?.agents}
      error={options?.error}
      liveness={options?.liveness}
      mate={options?.mate}
      view={buildZeropsServiceMap(view, options?.lifecycle, options?.runningTool)}
    />,
  );

/** The pop's body for the first row of the first group. */
const renderDetail = (view: ZeropsTopologyView, lifecycle?: ZeropsLifecycle): string => {
  const row = buildZeropsServiceMap(view, lifecycle)?.groups[0]?.rows[0];
  expect(row).toBeDefined();
  return renderToStaticMarkup(<ZeropsServiceDetail row={row!} />);
};

const classNamesForText = (html: string, text: string): ReadonlyArray<string> => {
  const escapedText = text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(
    `<(?:span|p) class="([^"]*)"[^>]*>${escapedText}</(?:span|p)>`,
    "u",
  ).exec(html);
  expect(match).not.toBeNull();
  return match?.[1]?.split(" ") ?? [];
};

describe("ZeropsServiceMap — the card", () => {
  it("renders liveness and semantic groups with shared primitives", () => {
    const html = render(
      topology([
        service({ hostname: "kanbandev" }),
        service({ hostname: "db", type: "postgresql:single@18", group: "data" }),
        service({ hostname: "zcp", type: "ubuntu/zcp@1", group: "infrastructure" }),
      ]),
      { liveness: "live" },
    );

    const runtimesAt = html.indexOf("Runtimes");
    const dataAt = html.indexOf("Data");
    const infrastructureAt = html.indexOf("Infrastructure");
    expect(runtimesAt).toBeGreaterThan(0);
    expect(dataAt).toBeGreaterThan(runtimesAt);
    expect(infrastructureAt).toBeGreaterThan(dataAt);
    expect(html.indexOf('data-zerops-primitive="liveness-line"')).toBeLessThan(runtimesAt);
    expect(html.match(/data-zerops-primitive="status-dot"/gu)).toHaveLength(4);
    expect(html).toContain('data-zerops-primitive="mint-panel"');
    expect(html).toContain("Zerops Control Plane");
    expect(html).toContain("kanbandev");
    // The platform's token is read as a word, never shown raw.
    expect(html).toContain(">Active<");
    expect(html).not.toContain(">ACTIVE<");
    expect(html).not.toContain("data-zerops-service-transient");
  });

  it("shows only the name, port, status word and the three resources — the rest waits in the pop", () => {
    const html = render(
      topology(
        [
          service({
            hostname: "app",
            typeName: "Node.js",
            version: "v22.22.3",
            ports: [{ port: 3000, scheme: "http" }],
            routes: [
              {
                port: 3000,
                url: "https://app-1d09-3000.prg1.zerops.app",
                host: "app-1d09-3000.prg1.zerops.app",
              },
            ],
            deploy: { source: "CLI", activatedAt: "2026-09-01T08:30:34Z" },
            usage,
            history,
          }),
        ],
        { usageRead: true },
      ),
    );

    expect(html).toContain(">:3000</span>");
    // The status word sits above the name, the type beside it — as the dashboard's card reads.
    expect(html.indexOf(">Active<")).toBeLessThan(html.indexOf(">app<"));
    expect(html).toContain(">Node.js 22</span>");
    expect(html).toContain("data-zerops-service-resources");
    expect(html.match(/data-zerops-service-graph="live"/gu)).toHaveLength(3);
    expect(html.match(/data-zerops-service-figure="live"/gu)).toHaveLength(3);
    expect(html).toContain('data-zerops-service-resource="cores"');
    expect(html).toContain('data-zerops-service-resource="memory"');
    expect(html).toContain('data-zerops-service-resource="disk"');
    expect(html).toContain("2.63");
    expect(html).not.toContain("Node.js v22.22.3");
    expect(html).not.toContain("Deployed from CLI");
    expect(html).not.toContain("data-zerops-service-detail");
    // The public route is the one thing reachable without hovering: a button at the card's right, the host as its label.
    expect(html).toContain("data-zerops-service-route-button");
    expect(html).toContain('aria-label="app-1d09-3000.prg1.zerops.app"');
    expect(html).toContain('href="https://app-1d09-3000.prg1.zerops.app"');
    expect(html).not.toContain(">app-1d09-3000.prg1.zerops.app<");
    expect(html.indexOf("data-zerops-service-route-button")).toBeGreaterThan(
      html.indexOf(">Node.js 22</span>"),
    );
    // The card is the pop's trigger, opening on hover.
    expect(html).toContain('data-slot="popover-trigger"');
  });

  it("draws each graph as a filled curve of use with the last hour marked", () => {
    const html = render(topology([service({ hostname: "app", history })]));

    expect(html.match(/data-zerops-service-graph="live"/gu)).toHaveLength(3);
    expect(html.match(/<circle/gu)).toHaveLength(3);
    expect(html).toContain('fill="url(#zerops-graph-svc-app-memory)"');
  });

  it("reserves the figures' and graphs' shape until the reads answer", () => {
    const html = render(topology([service({ hostname: "app" })]));

    expect(html.match(/data-zerops-service-figure="pending"/gu)).toHaveLength(3);
    expect(html.match(/data-zerops-service-graph="pending"/gu)).toHaveLength(3);
    expect(html).not.toContain("<svg");
  });

  it("shows no resources at all for a service holding nothing once usage is known", () => {
    const html = render(
      topology(
        [
          service({
            hostname: "app",
            status: "READY_TO_DEPLOY",
            history: [],
            // The envelope alone is not a resource the card can show.
            scaling: { cores: { min: 1, max: 3 } },
          }),
        ],
        { usageRead: true },
      ),
    );

    expect(html).not.toContain("data-zerops-service-resources");
    expect(html).not.toContain("<svg");
  });

  it("wraps long service identity without hiding status", () => {
    const hostname = "application-runtime-with-a-hostname-too-long-for-the-right-panel";
    const html = render(topology([service({ hostname })]));

    expect(classNamesForText(html, hostname)).toEqual(
      expect.arrayContaining(["min-w-0", "max-w-full", "break-all"]),
    );
    expect(html).not.toContain("truncate");
    expect(html).toContain("Active");
  });

  it("shows a stage service nested under its dev partner", () => {
    const html = render(
      topology([
        service({ hostname: "kanbandev" }),
        service({ hostname: "kanbanstage", status: "CREATING", transient: true }),
      ]),
    );

    expect(html).toContain("kanbandev");
    expect(html).toContain("data-zerops-service-stage");
    expect(html).toContain("kanbanstage");
    expect(html).toContain("Creating");
    expect(html.match(/data-zerops-service-row=/gu)).toHaveLength(1);
  });

  it("marks a transient service without animating it", () => {
    const html = render(
      topology([service({ hostname: "kanbandev", status: "CREATING", transient: true })]),
    );

    expect(html).toContain("data-zerops-service-transient");
    expect(html).toContain("Creating");
    expect(html).not.toContain("animate-spin");
  });

  it("exposes the shared service tone without coupling tests to classes", () => {
    const html = render(
      topology([
        service({ hostname: "failed", status: "FAILED" }),
        service({ hostname: "creating", status: "CREATING", transient: true }),
        service({ hostname: "active" }),
        service({ hostname: "fresh", status: "READY_TO_DEPLOY" }),
      ]),
    );

    expect(html).toContain('data-zerops-service-tone="error"');
    expect(html).toContain('data-zerops-service-tone="warning"');
    expect(html).toContain('data-zerops-service-tone="outline"');
    // Settled but not running is the off tone, never a green dot.
    expect(html).toContain('data-zerops-service-tone="muted"');
    expect(html).toMatch(/data-zerops-service-tone="muted"[^>]*data-zerops-status-tone="off"/u);
  });

  it("counts a group only when there is more than one of them", () => {
    const html = render(
      topology([
        service({ hostname: "api" }),
        service({ hostname: "web" }),
        service({ hostname: "db", type: "postgresql:single@18", group: "data" }),
      ]),
    );

    expect(html).toContain(">2</span>");
    expect(html).not.toContain(">1</span>");
  });

  it("names a running tool as a phrase, not a spinner", () => {
    const html = render(topology([service({ hostname: "kanbandev" })]), {
      runningTool: "zerops_deploy",
    });

    expect(html).toContain('data-zerops-running-tool="zerops_deploy"');
    expect(html).toContain("zerops_deploy running");
    expect(html).not.toContain("animate-spin");
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
    const html = render(topology([service({ hostname: "app" }), zcp]), { mate: fen });

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

  it("says nothing about a Mate when nobody is known to live here", () => {
    const html = render(topology([zcp]));

    expect(html).not.toContain("data-zerops-mate-home");
    expect(html).not.toContain("lives here");
  });

  it("hangs the agents card from the control-plane card, outside its hover pop", () => {
    const html = render(topology([service({ hostname: "app" }), zcp]), {
      mate: fen,
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

  it("hangs nothing when there is no agents card", () => {
    const html = render(topology([zcp]), { mate: fen });

    expect(html).not.toContain("data-zerops-agent-auth-tray");
  });
});

describe("ZeropsServiceDetail — the pop", () => {
  it("links the name to the service's page in the Zerops dashboard", () => {
    const html = renderDetail(topology([service({ hostname: "kanbandev", serviceId: "svc-1" })]));

    expect(html).toContain("data-zerops-service-dashboard");
    expect(html).toContain('href="https://app.zerops.io/service-stack/svc-1"');
    expect(html).toContain("lucide-arrow-up-right");
  });

  it("says what the service is and how it was deployed in one meta line", () => {
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
    expect(html).toMatch(/Node\.js v22\.22\.3 · Deployed from CLI [^<]*ago/u);
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
    expect(html).not.toContain("truncate");
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
  it("shows live liveness first while the platform websocket is connected", () => {
    const html = render(topology([service({ hostname: "kanbandev" })]), { liveness: "live" });

    expect(html).toContain('data-zerops-map-liveness="live"');
    expect(html).toContain('data-zerops-liveness="live"');
  });

  it("mentions polling quietly when the platform websocket is down", () => {
    const html = render(topology([service({ hostname: "kanbandev" })]), { liveness: "polling" });

    expect(html).toContain('data-zerops-map-liveness="polling"');
    expect(html).toContain("reconnecting");
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
