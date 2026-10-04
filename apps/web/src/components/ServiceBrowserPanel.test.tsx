import * as Schema from "effect/Schema";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  deployedVersionKey,
  nextHeldVersion,
  PREVIEW_COOKIE_NOTE_KEY,
  previewKey,
  ServiceBrowserPanels,
} from "./ServiceBrowserPanel";
import { removeLocalStorageItem, setLocalStorageItem } from "../hooks/useLocalStorage";
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
function render(
  url: string,
  topology: typeof services | undefined,
  addresses: ReadonlyArray<{ readonly url: string }> = [],
) {
  return renderToStaticMarkup(
    <ServiceBrowserPanels
      surfaces={[{ id: "service:web", kind: "browser", service: "web", url }]}
      activeSurfaceId="service:web"
      services={topology}
      addresses={addresses}
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
  /** The group's production lives in a project of its own; it is the Mate's address all the same. */
  it("loads an address of the Mate's group outside its own project", () => {
    const production = "https://app-3c4d-80.prg1.zerops.app";
    expect(render(production, services)).not.toContain("<iframe");
    expect(render(production, services, [{ url: production }])).toContain("<iframe");
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
describe("the cookie note", () => {
  afterEach(() => removeLocalStorageItem(PREVIEW_COOKIE_NOTE_KEY));
  it("says once that sign-ins and carts need a tab of their own, until it is read", () => {
    // Measured 2026-09-29: a framed *.zerops.app page is cross-site in every
    // client, and Chrome refused a Medusa storefront's unattributed cookie
    // there (SchemefulSameSiteUnspecifiedTreatedAsLax) while storing it
    // top-level. Unlike the removed footer, this is true of every preview.
    const unread = render(origin, services);
    expect(unread.match(/sign-ins and carts need a new tab/gu)).toHaveLength(1);
    expect(unread).toContain(">Got it</button>");
    expect(unread.match(/Open in new tab/gu)).toHaveLength(1);

    setLocalStorageItem(PREVIEW_COOKIE_NOTE_KEY, true, Schema.Boolean);
    const read = render(origin, services);
    expect(read).not.toContain("sign-ins and carts");
    expect(read).toContain("<iframe");
  });
  it("is not shown where there is no preview", () => {
    expect(render("https://gitea.example/pulls/4", services)).not.toContain("sign-ins and carts");
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
  // A page may route on its exact address (`req.url === "/"` answers `/`
  // and 404s `/?x=1`), so the frame loads the URL as it is shown.
  it.each([
    ["root", origin],
    ["path and fragment", `${origin}/pulls/4#top`],
    ["a page's own query", `${origin}/?flag&q=a%20b`],
  ])("the frame, the bar and the new-tab link all hold the same address: %s", (_, url) => {
    const html = render(url, deployed);
    const attribute = (name: string) =>
      [...html.matchAll(new RegExp(`${name}="([^"]*)"`, "gu"))].map((match) =>
        match[1]!.replaceAll("&amp;", "&"),
      );
    expect(attribute("src")).toEqual([url]);
    expect(attribute("href")).toEqual([url, url]);
  });
});
