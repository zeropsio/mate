import type { EnvironmentConnectionPresentation } from "@t3tools/client-runtime/connection";
import { EnvironmentId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ComposerBannerStack } from "./ComposerBannerStack";
import { environmentConnectionBannerItem } from "./EnvironmentConnectionBanner";

// What a zcp restart put on screen (gate CD, zcp-restart/03-during-2.png).
const RAW_ERROR =
  "Failed to fetch remote environment endpoint https://zcp-30db-8080.prg1.zerops.app/mate/.well-known/t3/environment (HttpClientError: Transport error (GET https://zcp-30db-8080.prg1.zerops.app/mate/.well-known/t3/environment)).";
const LEAKS = [
  /https?:\/\//,
  /\b[a-z0-9-]+(\.[a-z0-9-]+){2,}\b/i,
  /\b[A-Z][A-Za-z]*Error\b/,
  /Reason:/,
];

const connection = (
  phase: EnvironmentConnectionPresentation["phase"],
  error: string | null,
): EnvironmentConnectionPresentation => ({ phase, error, traceId: error ? "trace-1" : null });

function render(presentation: EnvironmentConnectionPresentation, mateName: string | null) {
  const item = environmentConnectionBannerItem({
    environmentId: EnvironmentId.make("environment-1"),
    connection: presentation,
    mateName,
    onRetry: () => undefined,
  });
  return item === null ? null : renderToStaticMarkup(<ComposerBannerStack items={[item]} />);
}

function visibleText(markup: string): string {
  return markup.replace(/<[^>]+>/g, " ").replaceAll("&#x27;", "'");
}

describe("environmentConnectionBannerItem", () => {
  it.each([
    {
      name: "reconnecting after a failure",
      presentation: connection("reconnecting", RAW_ERROR),
      buttons: 1,
    },
    { name: "reconnecting", presentation: connection("reconnecting", null), buttons: 1 },
    { name: "refused", presentation: connection("error", RAW_ERROR), buttons: 1 },
    { name: "offline", presentation: connection("offline", null), buttons: 1 },
    { name: "connecting", presentation: connection("connecting", null), buttons: 1 },
    // Trying now leaves a connection nobody asked for where it is, so no
    // verb claims to connect it.
    { name: "not asked to connect", presentation: connection("available", null), buttons: 0 },
  ])(
    "$name: names the cause, $buttons verb(s), no transport detail",
    ({ presentation, buttons }) => {
      for (const mateName of ["Wren", null]) {
        const markup = render(presentation, mateName);
        expect(markup).not.toBeNull();
        expect(markup?.match(/<button\b/g) ?? []).toHaveLength(buttons);
        const text = visibleText(markup ?? "");
        for (const leak of LEAKS) {
          expect(text).not.toMatch(leak);
        }
        if (mateName !== null && presentation.phase !== "offline") {
          expect(text).toContain(mateName);
        }
      }
    },
  );

  it("says why a reconnect is under way, without the failure's own words", () => {
    const text = visibleText(render(connection("reconnecting", RAW_ERROR), "Wren") ?? "");
    expect(text).toContain("Reconnecting to Wren…");
    expect(text).toContain("Wren isn't answering. It may be restarting.");
    expect(text).toContain("Try now");
    expect(text).not.toContain("Connections");
  });

  it("has no banner for a connected Mate", () => {
    expect(render(connection("connected", null), "Wren")).toBeNull();
  });
});
