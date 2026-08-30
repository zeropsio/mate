import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import type { ZeropsLifecycle, ZeropsService, ZeropsTopologySnapshot } from "@t3tools/contracts";

import { buildZeropsServiceMap } from "@t3tools/client-runtime/zerops/serviceMap";
import { ZeropsServiceMap } from "./ZeropsServiceMap";

const service = (overrides: Partial<ZeropsService> & { hostname: string }): ZeropsService =>
  ({
    serviceId: `svc-${overrides.hostname}`,
    type: "ubuntu/nodejs@22",
    status: "ACTIVE",
    group: "runtimes",
    adoptionState: "adopted",
    isManagedService: false,
    transient: false,
    mounted: false,
    ...overrides,
  }) as ZeropsService;

const topology = (
  services: ReadonlyArray<ZeropsService>,
  overrides?: Partial<ZeropsTopologySnapshot>,
): ZeropsTopologySnapshot =>
  ({
    available: true,
    degraded: false,
    project: { id: "proj-1", name: "z3-eval", status: "ACTIVE" },
    services,
    warnings: [],
    readAt: new Date("2026-08-28T10:00:00Z"),
    ...overrides,
  }) as unknown as ZeropsTopologySnapshot;

const render = (
  snapshot: ZeropsTopologySnapshot | undefined,
  lifecycle?: ZeropsLifecycle,
): string =>
  renderToStaticMarkup(<ZeropsServiceMap view={buildZeropsServiceMap(snapshot, lifecycle)} />);

describe("ZeropsServiceMap", () => {
  it("renders each group with its services", () => {
    const html = render(
      topology([
        service({ hostname: "kanbandev", mounted: true, mountPath: "/var/www/kanbandev" }),
        service({
          hostname: "db",
          type: "postgresql:single@18",
          group: "data",
          isManagedService: true,
        }),
      ]),
    );

    expect(html).toContain("Runtimes");
    expect(html).toContain("Data");
    expect(html).toContain("kanbandev");
    expect(html).toContain("nodejs@22");
    expect(html).toContain("postgresql:single@18");
    expect(html).not.toContain("data-zerops-service-transient");
    // The mount path itself is the badge's text: where a service is mounted is
    // the useful half, and a bare "mounted" hid it behind a hover.
    expect(html).toContain("/var/www/kanbandev");
  });

  it("offers Open for a service that has a subdomain", () => {
    const html = render(
      topology([
        service({
          hostname: "kanbandev",
          subdomainEnabled: true,
          subdomainUrl: "https://kanbandev-26a7-3000.prg1.zerops.app",
        }),
      ]),
    );

    expect(html).toContain('href="https://kanbandev-26a7-3000.prg1.zerops.app"');
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
      threadId: "thread-a",
      recentTools: [
        {
          toolName: "zerops_deploy",
          status: "inProgress",
          at: new Date("2026-08-28T10:01:00Z"),
        },
      ],
    } as unknown as ZeropsLifecycle);

    expect(html).toContain('data-zerops-running-tool="zerops_deploy"');
    expect(html).toContain("zerops_deploy running");
    expect(html).not.toContain("animate-spin");
  });

  it("says there is nothing yet rather than showing empty groups", () => {
    const html = render(topology([]));

    expect(html).toContain("No services yet");
    expect(html).not.toContain("Runtimes");
  });

  /**
   * `available: false` means this is not a Zerops environment. The panel must
   * be absent — an empty-state card would tell a plain T3 user about a product
   * they are not using.
   */
  it("renders nothing at all when there is no Zerops here", () => {
    expect(render(undefined)).toBe("");
    expect(render(topology([], { available: false, reason: "zcp-not-found" }))).toBe("");
  });

  it("flags a degraded read quietly, keeping the last good rows", () => {
    const html = render(
      topology([service({ hostname: "kanbandev" })], {
        degraded: true,
        reason: "zcp studio topology: exit 1",
      }),
    );

    expect(html).toContain("data-zerops-map-degraded");
    expect(html).toContain("zcp studio topology: exit 1");
    expect(html).toContain("kanbandev");
  });

  it("shows zcp's warnings", () => {
    const html = render(
      topology([service({ hostname: "s6fix1", adoptionState: "adoptable" })], {
        warnings: ["2 services can be adopted: s6fix1, s6fix2"],
      }),
    );

    expect(html).toContain("2 services can be adopted");
  });
});

describe("ZeropsServiceMap — liveness", () => {
  const withDoorbell = (doorbellConnected?: boolean): string =>
    render(
      topology(
        [service({ hostname: "kanbandev" })],
        (doorbellConnected === undefined
          ? {}
          : { doorbellConnected }) as Partial<ZeropsTopologySnapshot>,
      ),
    );

  it("says nothing while push updates are live", () => {
    expect(withDoorbell(true)).not.toContain("data-zerops-map-liveness");
  });

  it("mentions polling quietly when push updates have dropped", () => {
    const html = withDoorbell(false);

    expect(html).toContain('data-zerops-map-liveness="polling"');
    expect(html).toContain("reconnecting");
    // Quiet, not alarming: this is not the degraded banner.
    expect(html).not.toContain("data-zerops-map-degraded");
  });

  it("says nothing when the feed reported no doorbell at all", () => {
    expect(withDoorbell()).not.toContain("data-zerops-map-liveness");
  });
});
