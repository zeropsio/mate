import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { ServiceBrowserPanels } from "./ServiceBrowserPanel";
import type { ZeropsTopologyService } from "@t3tools/client-runtime/zerops/topology";

const origin = "https://web-2ff4-3000.prg1.zerops.app";
const services: ZeropsTopologyService[] = [
  {
    hostname: "web",
    serviceId: "web",
    type: "nodejs@22",
    status: "ACTIVE",
    group: "runtimes",
    transient: false,
    ports: [],
    routes: [{ url: origin, host: "web-2ff4-3000.prg1.zerops.app", port: 3000 }],
  },
];
function render(url: string, topology: typeof services | undefined) {
  return renderToStaticMarkup(
    <ServiceBrowserPanels
      surfaces={[{ id: "service:web", kind: "browser", service: "web", url }]}
      activeSurfaceId="service:web"
      services={topology}
    />,
  );
}
describe("restored service previews", () => {
  it("loads a confirmed service", () => {
    expect(render(origin, services)).toContain("<iframe");
    expect(render(origin + "/mate/shortlink/pulls/4", services)).toContain("<iframe");
  });
  it.each(["https://gitea.example/pulls/4"])("never loads a restored excluded URL: %s", (url) => {
    const html = render(url, services);
    expect(html).not.toContain("<iframe");
    expect(html).toContain("Open in new tab");
  });
  it("waits for known topology before loading a restored page", () => {
    expect(render(origin, undefined)).not.toContain("<iframe");
  });
  it("apologises for nothing: the way out is the header's, and it is said once", () => {
    // A frame a site refused to draw cannot be told from one it drew —
    // measured in Chrome, both fire `load` and both throw on a cross-origin
    // read — so the footer that explained it was shown under every working
    // preview, with a second copy of the control above it.
    const html = render(origin, services);
    expect(html).not.toContain("Page not showing");
    expect(html.match(/Open in new tab/gu)).toHaveLength(1);
  });
});
