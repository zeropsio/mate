import type { EnvironmentConnectionPresentation } from "@t3tools/client-runtime/connection";
import { EnvironmentId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { ComposerBannerStack } from "./ComposerBannerStack";
import {
  environmentConnectionBannerItem,
  mateVoiceBannerItem,
  environmentRetryFailureToast,
} from "./EnvironmentConnectionBanner";

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

describe("environmentRetryFailureToast", () => {
  it.each([
    { name: "a typed failure", result: AsyncResult.failure(Cause.fail(new Error(RAW_ERROR))) },
    { name: "a defect", result: AsyncResult.failure(Cause.die(new Error(RAW_ERROR))) },
  ])("$name: says what to do, never the failure's words", ({ result }) => {
    const toast = environmentRetryFailureToast(result);
    expect(toast).toEqual({
      title: "Couldn't reconnect",
      description: "Reload the page to try again.",
    });
    const text = `${toast?.title}\n${toast?.description}`;
    for (const leak of LEAKS) {
      expect(text).not.toMatch(leak);
    }
  });

  it.each([
    { name: "a retry that ran", result: AsyncResult.success(undefined) },
    { name: "an interrupted retry", result: AsyncResult.failure(Cause.interrupt(0)) },
  ])("$name: says nothing", ({ result }) => {
    expect(environmentRetryFailureToast(result)).toBeNull();
  });
});

describe("Mate lifecycle recovery actions", () => {
  it.each([
    { action: "start" as const, label: "Start", tone: "default" as const },
    { action: "restart" as const, label: "Retry restart", tone: "error" as const },
  ])("offers $label directly with its source severity", ({ action, label, tone }) => {
    const item = mateVoiceBannerItem({
      environmentId: EnvironmentId.make("env-Wren"),
      voice: {
        surface: "banner",
        text: "Wren's container needs attention.",
        actions: [action, "open-in-zerops"],
        processes: false,
        severity: tone === "error" ? "danger" : "info",
      },
      onRetry: () => undefined,
      onContainerAction: () => undefined,
      projects: <a href="/zerops" />,
      projectUrl: "https://app.zerops.io/project/Wren",
    });
    expect(item?.variant).toBe(tone);
    const html = renderToStaticMarkup(item?.actions);
    expect(html).toContain(label);
    expect(html).toContain("https://app.zerops.io/project/Wren");
    expect(html).not.toContain("Go to projects");
  });
});

describe("a restart notice beside an open conversation", () => {
  it("shows the named restart immediately and rotates its jokes without claiming readiness", async () => {
    const { act } = await import("react");
    const { create } = await import("react-test-renderer");
    const { mateVoiceBannerItem } = await import("./EnvironmentConnectionBanner");
    const { mateNoticeVoice } = await import("../../zerops/mateNoticeVoice");
    let reduced = false;
    vi.stubGlobal("window", { matchMedia: () => ({ matches: reduced }) });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const item = mateVoiceBannerItem({
      environmentId: EnvironmentId.make("environment-1"),
      voice: mateNoticeVoice({
        reachability: { kind: "ready", notice: { level: "restarting", by: "you", overdue: false } },
        conversationShown: true,
        mateName: "Rosa",
        nowMs: 0,
      }),
      onRetry: () => undefined,
      projects: <a>Projects</a>,
    });
    expect(item?.title).toBe("Rosa is restarting.");
    let rendered: ReturnType<typeof create> | undefined;
    try {
      act(() => {
        rendered = create(<>{item?.description}</>);
      });
      const words = () => rendered!.root.findByType("span");
      const first = words().children.join("");
      expect(first).toContain("Rosa");
      act(() => words().props.onAnimationIteration({ animationName: "mate-restart-words" }));
      const second = words().children.join("");
      expect(second).toContain("Rosa");
      expect(second).not.toBe(first);
      expect(item?.title).toBe("Rosa is restarting.");
      reduced = true;
      act(() => words().props.onAnimationIteration({ animationName: "mate-restart-words" }));
      expect(words().children.join("")).toBe(second);
    } finally {
      act(() => rendered?.unmount());
      vi.unstubAllGlobals();
    }

  });
});
