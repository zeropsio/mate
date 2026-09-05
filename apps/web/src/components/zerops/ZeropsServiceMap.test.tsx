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
  ...overrides,
});

const topology = (
  services: ReadonlyArray<ZeropsTopologyService>,
  overrides?: Partial<ZeropsTopologyView>,
): ZeropsTopologyView => ({
  project: { id: "proj-1", name: "z3-eval", status: "ACTIVE" },
  services,
  warnings: [],
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
  const match = new RegExp(`<span class="([^"]*)"[^>]*>${escapedText}</span>`, "u").exec(html);
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
    expect(html).toContain("postgresql:single@18");
    expect(html).not.toContain("data-zerops-service-transient");
  });

  it("wraps long service identity without hiding status or links", () => {
    const hostname = "application-runtime-with-a-hostname-too-long-for-the-right-panel";
    const typeLabel = "nodejs-with-an-unusually-long-runtime-type@2026.09.01";
    const subdomainUrl = "https://application-runtime.prg1.zerops.app";
    const html = render(
      topology([service({ hostname, type: `ubuntu/${typeLabel}`, subdomainUrl })]),
    );

    expect(classNamesForText(html, hostname)).toEqual(
      expect.arrayContaining(["min-w-0", "max-w-full", "break-all"]),
    );
    expect(classNamesForText(html, typeLabel)).toEqual(
      expect.arrayContaining(["min-w-0", "max-w-full", "break-words"]),
    );
    expect(html).not.toContain("truncate");
    expect(html).toContain("ACTIVE");
    expect(html).toContain(`href="${subdomainUrl}"`);
    expect(html).toContain("Open");
  });

  it("offers Open for a service that has a subdomain", () => {
    const html = render(
      topology([
        service({
          hostname: "kanbandev",
          subdomainUrl: "https://kanbandev-26a7-3000.prg1.zerops.app",
        }),
      ]),
    );

    expect(html).toContain('href="https://kanbandev-26a7-3000.prg1.zerops.app"');
    expect(html).toContain('class="lucide lucide-external-link size-3"');
    expect(html).toContain("Open");
  });

  it("shows a stage service nested under its dev partner", () => {
    const html = render(
      topology([
        service({ hostname: "kanbandev" }),
        service({ hostname: "kanbanstage", status: "CREATING", transient: true }),
      ]),
    );

    expect(html).toContain("kanbandev");
    expect(html).toContain("kanbanstage");
    expect(html).toContain("CREATING");
  });

  it("marks a transient service without animating it", () => {
    const html = render(
      topology([service({ hostname: "kanbandev", status: "CREATING", transient: true })]),
    );

    expect(html).toContain("data-zerops-service-transient");
    expect(html).toContain("CREATING");
    expect(html).not.toContain("animate-spin");
  });

  it("exposes the shared service tone without coupling tests to classes", () => {
    const html = render(
      topology([
        service({ hostname: "failed", status: "FAILED" }),
        service({ hostname: "creating", status: "CREATING", transient: true }),
        service({ hostname: "active" }),
      ]),
    );

    expect(html).toContain('data-zerops-service-tone="error"');
    expect(html).toContain('data-zerops-service-tone="warning"');
    expect(html).toContain('data-zerops-service-tone="outline"');
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
