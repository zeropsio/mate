import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { mateAddresses } from "~/zerops/mateAddresses.logic";
import { BrowserSites } from "./ZeropsBrowserSurface";

const THREAD_REF = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};

const route = (hostname: string) => ({
  hostname,
  group: "runtimes" as const,
  routes: [{ url: `https://${hostname}-a1b2-8000.prg1.zerops.app` }],
});

/** The text of every heading and row, in the order the list draws them. */
function shown(html: string): ReadonlyArray<string> {
  return [...html.matchAll(/<h3[^>]*>(.*?)<\/h3>|<button[^>]*>(.*?)<\/button>/gu)].map(
    ([, heading, row]) =>
      heading === undefined
        ? [...row!.matchAll(/<span[^>]*>(.*?)<\/span>/gu)].map(([, part]) => part).join(" ")
        : `# ${heading.replace(/<[^>]+>/gu, "")}`,
  );
}

describe("BrowserSites", () => {
  it("shows each environment's heading over rows named by their service, the host beside each", () => {
    const addresses = mateAddresses({
      services: [route("nextstoredev"), route("nextstorestage"), route("mailpit")],
      environments: [
        {
          projectId: "p-prod",
          name: "nextstore production",
          role: "prod",
          routes: [{ service: "nextstore", url: "https://nextstore-c3d4-8000.prg1.zerops.app" }],
        },
      ],
    });
    const html = renderToStaticMarkup(
      <BrowserSites addresses={addresses} threadRef={THREAD_REF} />,
    );
    expect(shown(html)).toEqual([
      "# Development",
      "nextstoredev nextstoredev-a1b2-8000.prg1.zerops.app",
      "# Preview",
      "nextstorestage nextstorestage-a1b2-8000.prg1.zerops.app",
      "# Production",
      "nextstore nextstore-c3d4-8000.prg1.zerops.app",
      "# Tools",
      "mailpit mailpit-a1b2-8000.prg1.zerops.app",
    ]);
    // Every row also opens its site in a new browser tab.
    expect(html.match(/aria-label="Open [^"]+ in a new tab"/gu)).toHaveLength(4);
  });

  it("shows nothing before the Mate has a site", () => {
    expect(renderToStaticMarkup(<BrowserSites addresses={[]} threadRef={THREAD_REF} />)).toBe("");
  });
});
