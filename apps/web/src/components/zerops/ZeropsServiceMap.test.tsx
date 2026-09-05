import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import type { ZeropsLifecycle } from "@t3tools/contracts";

import { buildZeropsServiceMap } from "@t3tools/client-runtime/zerops/serviceMap";
import type {
  ZeropsTopologyService,
  ZeropsTopologyView,
} from "@t3tools/client-runtime/zerops/topology";
import { ZeropsServiceMap } from "./ZeropsServiceMap";

const service = (
  overrides: Partial<ZeropsTopologyService> & { hostname: string },
): ZeropsTopologyService => ({
  serviceId: `svc-${overrides.hostname}`,
  type: "ubuntu/nodejs@22",
  status: "ACTIVE",
  group: "runtimes",
  transient: false,
  ports: [],
  routes: [],
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

const render = (
  view: ZeropsTopologyView | undefined,
  options?: {
    readonly lifecycle?: ZeropsLifecycle;
    readonly liveness?: "live" | "polling";
    readonly error?: string;
    readonly runningTool?: string;
  },
): string =>
  renderToStaticMarkup(
    <ZeropsServiceMap
      error={options?.error}
      liveness={options?.liveness}
      view={buildZeropsServiceMap(view, options?.lifecycle, options?.runningTool)}
    />,
  );

const classNamesForText = (html: string, text: string): ReadonlyArray<string> => {
  const escapedText = text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(
    `<(?:span|p) class="([^"]*)"[^>]*>${escapedText}</(?:span|p)>`,
    "u",
  ).exec(html);
  expect(match).not.toBeNull();
  return match?.[1]?.split(" ") ?? [];
};

describe("ZeropsServiceMap", () => {
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
    expect(html).toContain("nodejs@22");
    // The platform's token is read as a word, never shown raw.
    expect(html).toContain(">Active<");
    expect(html).not.toContain(">ACTIVE<");
    expect(html).toContain("postgresql:single@18");
    expect(html).not.toContain("data-zerops-service-transient");
  });

  it("wraps long service identity without hiding status or links", () => {
    const hostname = "application-runtime-with-a-hostname-too-long-for-the-right-panel";
    const typeLabel = "nodejs-with-an-unusually-long-runtime-type@2026.09.01";
    const subdomainUrl = "https://application-runtime.prg1.zerops.app";
    const html = render(
      topology([
        service({
          hostname,
          type: `ubuntu/${typeLabel}`,
          subdomainUrl,
          routes: [{ port: 80, url: subdomainUrl, host: "application-runtime.prg1.zerops.app" }],
        }),
      ]),
    );

    expect(classNamesForText(html, hostname)).toEqual(
      expect.arrayContaining(["min-w-0", "max-w-full", "break-all"]),
    );
    expect(classNamesForText(html, typeLabel)).toEqual(
      expect.arrayContaining(["min-w-0", "max-w-full", "break-words"]),
    );
    expect(html).not.toContain("truncate");
    expect(html).toContain("Active");
    expect(html).toContain(`href="${subdomainUrl}"`);
  });

  it("lists every public route as its host, a link, instead of one Open button", () => {
    const html = render(
      topology([
        service({
          hostname: "kanbandev",
          subdomainUrl: "https://kanbandev-26a7.prg1.zerops.app",
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
    expect(html).not.toContain(">Open<");
  });

  it("links every card's name to the service's page in the Zerops dashboard", () => {
    const html = render(topology([service({ hostname: "kanbandev", serviceId: "svc-1" })]));

    expect(html).toContain("data-zerops-service-dashboard");
    expect(html).toContain('href="https://app.zerops.io/service-stack/svc-1"');
    expect(html).toContain("lucide-arrow-right");
  });

  it("shows the declared port after the name, and the hostname in the control plane's meta line", () => {
    const html = render(
      topology([
        service({ hostname: "app", ports: [{ port: 3000, scheme: "http" }] }),
        service({
          hostname: "zcp",
          type: "zcp@1",
          group: "infrastructure",
          ports: [{ port: 8080, scheme: "http" }],
        }),
      ]),
    );

    expect(html).toContain(">:3000</span>");
    expect(html).toContain("Zerops Control Plane");
    expect(html).toContain("zcp:8080 · zcp@1");
  });

  it("says what the service is and how it was deployed in one meta line", () => {
    const html = render(
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

  it("reserves the strip while the first usage read is out, then shows the live figures", () => {
    const usage = {
      containers: 1,
      cores: { used: 0.076, limit: 2 },
      memoryGb: { used: 0.512, limit: 2.625 },
      diskGb: { used: 0.161, limit: 2 },
    };
    const pending = render(topology([service({ hostname: "app" })]));
    expect(pending).toContain('data-zerops-service-strip="pending"');
    expect(pending).not.toContain("data-zerops-service-metric=");

    const live = render(topology([service({ hostname: "app", usage })], { usageRead: true }));
    expect(live).toContain('data-zerops-service-strip="live"');
    expect(live).toContain('data-zerops-service-metric="containers"');
    expect(live).toContain('data-zerops-service-metric="cores"');
    expect(live).toContain("2.63");
    expect(live).toContain('style="width:4%"');
    expect(live).toContain('style="width:20%"');
  });

  it("shows no strip for a service holding no container once usage is known", () => {
    const html = render(topology([service({ hostname: "app" })], { usageRead: true }));

    expect(html).not.toContain("data-zerops-service-strip");
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

  it("offers a production project as a linked chip", () => {
    const lifecycle = {
      threadId: "thread-1",
      envelope: {
        services: [{ hostname: "kanbandev", feedsProduction: ["Acme (proj-1)"] }],
      },
    } as unknown as ZeropsLifecycle;
    const html = render(topology([service({ hostname: "kanbandev" })]), { lifecycle });

    expect(html).toContain("data-zerops-service-routes");
    expect(html).toContain("Production · Acme");
    expect(html).toContain('href="https://app.zerops.io/project/proj-1"');
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
