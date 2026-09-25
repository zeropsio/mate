import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import {
  deployedVersionKey,
  nextHeldVersion,
  previewKey,
  previewSrc,
  ServiceBrowserPanels,
} from "./ServiceBrowserPanel";
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
describe("previewSrc", () => {
  it.each([
    [
      "no query",
      "https://web.prg1.zerops.app",
      "k1",
      "https://web.prg1.zerops.app/?_mate_preview=k1",
    ],
    [
      "trailing slash",
      "https://web.prg1.zerops.app/",
      "k1",
      "https://web.prg1.zerops.app/?_mate_preview=k1",
    ],
    [
      "path",
      "https://web.prg1.zerops.app/a/b",
      "k1",
      "https://web.prg1.zerops.app/a/b?_mate_preview=k1",
    ],
    [
      "existing query",
      "https://web.prg1.zerops.app/?a=1&b=2",
      "k1",
      "https://web.prg1.zerops.app/?a=1&b=2&_mate_preview=k1",
    ],
    [
      "query as written",
      "https://web.prg1.zerops.app/?flag&q=a%20b",
      "k1",
      "https://web.prg1.zerops.app/?flag&q=a%20b&_mate_preview=k1",
    ],
    [
      "fragment",
      "https://web.prg1.zerops.app/p#top",
      "k1",
      "https://web.prg1.zerops.app/p?_mate_preview=k1#top",
    ],
    [
      "query and fragment",
      "https://web.prg1.zerops.app/p?a=1#top",
      "k1",
      "https://web.prg1.zerops.app/p?a=1&_mate_preview=k1#top",
    ],
    [
      "key needing encoding",
      "https://web.prg1.zerops.app/",
      "2026-09-25T11:11:41Z.0",
      "https://web.prg1.zerops.app/?_mate_preview=2026-09-25T11%3A11%3A41Z.0",
    ],
  ])("%s", (_, url, key, expected) => {
    expect(previewSrc(url, key)).toBe(expected);
  });
});
describe("deployedVersionKey", () => {
  const at = "2026-09-25T11:11:41Z";
  it.each<[string, ZeropsTopologyService["deploy"], string | undefined]>([
    ["never deployed", undefined, undefined],
    ["source only", { source: "CLI" }, undefined],
    ["activation time", { source: "CLI", activatedAt: at }, at],
    ["activation time and name", { source: "GIT", activatedAt: at, name: "abc123 fix" }, at],
    ["name only", { source: "GIT", name: "abc123 fix" }, "abc123 fix"],
  ])("%s", (_, deploy, expected) => {
    expect(deployedVersionKey(deploy)).toBe(expected);
  });
});
describe("previewKey across topology updates and reloads", () => {
  const first = "2026-09-25T10:00:00Z";
  const second = "2026-09-25T11:11:41Z";
  type Step = { version?: string; reload?: true };
  function keys(steps: Step[]): string[] {
    let held: string | undefined;
    let revision = 0;
    return steps.map((step) => {
      held = nextHeldVersion(held, step.version);
      if (step.reload) revision += 1;
      return previewKey(held, revision);
    });
  }
  it.each<[string, Step[], string[]]>([
    [
      "unrelated updates keep the key",
      [{ version: first }, { version: first }, { version: first }],
      [`${first}.0`, `${first}.0`, `${first}.0`],
    ],
    [
      "a new deployed version changes it",
      [{ version: first }, { version: second }],
      [`${first}.0`, `${second}.0`],
    ],
    [
      "a frame naming no version keeps it",
      [{ version: first }, {}, { version: first }],
      [`${first}.0`, `${first}.0`, `${first}.0`],
    ],
    [
      "a reload changes it",
      [{ version: first }, { version: first, reload: true }],
      [`${first}.0`, `${first}.1`],
    ],
    ["a never-deployed service reloads by counter", [{}, { reload: true }], ["none.0", "none.1"]],
  ])("%s", (_, steps, expected) => {
    expect(keys(steps)).toEqual(expected);
  });
});
describe("the preview's addresses", () => {
  const at = "2026-09-25T11:11:41Z";
  const deployed = services.map((service) => ({
    ...service,
    deploy: { source: "CLI", activatedAt: at },
  }));
  it.each([
    ["root", origin],
    ["path and fragment", `${origin}/pulls/4#top`],
  ])("the frame loads the keyed URL, the bar and the new-tab link show it clean: %s", (_, url) => {
    const html = render(url, deployed);
    expect(html).toContain(`src="${previewSrc(url, previewKey(at, 0))}"`);
    expect(html.match(/href="([^"]*)"/gu)).toEqual([`href="${url}"`, `href="${url}"`]);
    expect(html).toContain(`>${url}</a>`);
    expect(html.match(/_mate_preview/gu)).toHaveLength(1);
  });
});
