// @vitest-environment happy-dom
import { NO_RESTARTS, readRestartRecovery } from "@t3tools/client-runtime/data";
import type { Reachability } from "@t3tools/client-runtime/zerops/environments";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import { mateNoticeVoice } from "../../zerops/mateNoticeVoice";
import { MateLinkLineView } from "./MateLinkLine";
import { MateConnectionState, MateEmptyStateView } from "./ZeropsMateEmptyState";

it("keeps opening quiet through the attempt, then offers recovery only on a failure", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const retry = vi.fn();
  const show = async (reachability: Reachability | null) => {
    const voice = mateNoticeVoice({
      reachability,
      mateName: "Rosa",
      conversationShown: false,
      nowMs: 0,
    });
    if (voice.surface === "none") return;
    await act(() =>
      root.render(
        <MateConnectionState
          mate={{
            name: "Rosa",
            tint: "slate",
            shape: "squircle",
            project: "Orchard",
            connected: false,
          }}
          face={voice.face ?? "idle"}
          headline={voice.headline ?? ""}
          secondary={voice.secondary ?? ""}
          actions={
            <MateLinkLineView
              voice={{ ...voice, text: null }}
              processes={null}
              projects={<a>Projects</a>}
              projectUrl={undefined}
              onTryNow={voice.actions.length === 0 ? undefined : retry}
            />
          }
        />,
      ),
    );
  };
  try {
    for (const reachability of [
      null,
      { kind: "resolving" },
      { kind: "connecting", waitingOn: "presence" },
      { kind: "connecting", waitingOn: "descriptor" },
      { kind: "connecting", waitingOn: "access" },
      { kind: "connecting", waitingOn: "exchange" },
    ] satisfies Array<Reachability | null>) {
      await show(reachability);
      expect(
        host.querySelector('[data-swap-layer]:not([data-swap-layer="leaving"]) h1')?.textContent,
      ).toBe("Rosa is opening the conversation.");
      expect(host.textContent).toContain("Picking up where you left off.");
      expect(host.querySelector("button")).toBeNull();
      expect(host.textContent).not.toContain("Project services");
    }
    await show({ kind: "not-answering", overdue: false });
    expect(
      host.querySelector('[data-swap-layer]:not([data-swap-layer="leaving"]) h1')?.textContent,
    ).toBe("Rosa isn't answering.");
    expect(host.querySelector("button")?.textContent).toBe("Try now");
    await act(() => host.querySelector<HTMLButtonElement>("button")!.click());
    expect(retry).toHaveBeenCalledOnce();
    await show({ kind: "connecting", waitingOn: "exchange" });
    expect(host.querySelector("button")).toBeNull();
    expect(
      host.querySelector('[data-swap-layer]:not([data-swap-layer="leaving"]) h1')?.textContent,
    ).toBe("Rosa is opening the conversation.");
  } finally {
    await act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("draws the known restart immediately and rotates named words only as its animation repeats", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const show = (restarting: boolean) =>
    root.render(
      <MateEmptyStateView
        mate={{
          name: "Rosa",
          tint: "slate",
          shape: "squircle",
          project: "Orchard",
          connected: false,
        }}
        phase={null}
        signIn={null}
        signInRequired={false}
        unknown={null}
        coming={{
          kind: "reaching",
          face: restarting ? "waking" : "sleep",
          headline: restarting ? "Rosa is restarting." : "Rosa isn't answering.",
          sentence: "Try now.",
          restarting,
          below: null,
        }}
      />,
    );
  const words = () =>
    host.querySelector("[data-arrival-sentence] [data-swap-layer]:not([aria-hidden])")?.textContent;
  const cycle = async () => {
    const event = new Event("animationiteration", { bubbles: true });
    Object.assign(event, { animationName: "mate-face-restart-shake" });
    await act(() => host.querySelector("[data-mate-face-moment-box]")!.dispatchEvent(event));
  };
  try {
    await act(() => show(true));
    expect(
      host
        .querySelector('[data-zerops-primitive="mate-face"]')
        ?.getAttribute("data-mate-face-state"),
    ).toBe("waking");
    expect(host.textContent).toContain("Rosa is restarting.");
    const first = words();
    expect(first).toContain("Rosa");
    await act(() => show(true));
    expect(words()).toBe(first);
    await cycle();
    expect(words()).toContain("Rosa");
    expect(words()).not.toBe(first);
    await act(() => show(false));
    await cycle();
    expect(words()).toBe("Try now.");
    await act(() => show(true));
    expect(words()).toBe(first);
  } finally {
    await act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("keeps a restarting Mate and its words still with reduced motion", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const media = window.matchMedia;
  window.matchMedia = vi.fn((query: string) => ({
    ...media.call(window, query),
    matches: true,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  }));
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(() =>
      root.render(
        <MateEmptyStateView
          mate={{
            name: "Rosa",
            tint: "slate",
            shape: "squircle",
            project: "Orchard",
            connected: false,
          }}
          phase={null}
          signIn={null}
          signInRequired={false}
          unknown={null}
          coming={{
            kind: "reaching",
            face: "waking",
            headline: "Rosa is restarting.",
            restarting: true,
            below: null,
          }}
        />,
      ),
    );
    const before = host.textContent;
    const event = new Event("animationiteration", { bubbles: true });
    Object.assign(event, { animationName: "mate-face-restart-shake" });
    await act(() => host.querySelector("[data-mate-face-moment-box]")!.dispatchEvent(event));
    expect(host.textContent).toBe(before);
    expect(host.querySelector("[data-mate-face-moment]")).toBeNull();
  } finally {
    await act(() => root.unmount());
    window.matchMedia = media;
    vi.unstubAllGlobals();
  }
});

it("a stand-up message that failed plays no success dance", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  const show = (failed: boolean) =>
    root.render(
      <MateEmptyStateView
        mate={{ name: "Rosa", tint: "rose", shape: "flower", project: "Orchard", connected: true }}
        phase="standing-up"
        signIn={null}
        signInRequired={false}
        unknown={null}
        standUpFailure={failed ? { retrying: false, retry: () => undefined } : undefined}
      />,
    );
  try {
    await act(() => show(false));
    await act(() => show(true));
    expect(host.textContent).toContain("The message to Rosa didn't go through.");
    expect(host.querySelector('[data-mate-face-moment="dance"]')).toBeNull();
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("a failed restart keeps raw diagnostics collapsed below its named state and actions", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const process = {
    id: "restart",
    projectId: "p",
    serviceStackIds: ["s"],
    created: "2026-10-07",
    actionName: "stack.restart",
    status: "FAILED",
    failReason: "500: Internal Server Error",
  };
  const voice = mateNoticeVoice({
    reachability: null,
    mateName: "Eddy",
    conversationShown: false,
    nowMs: 0,
    lastKnown: "Eddy was last working on the build.",
    recovery: {
      standing: { kind: "unknown" },
      status: "ACTION_FAILED",
      process,
      lifecycle: readRestartRecovery(NO_RESTARTS, process, "ACTION_FAILED"),
    },
  });
  if (voice.surface === "none") throw new Error("Missing failure notice");
  try {
    await act(() =>
      root.render(
        <MateConnectionState
          mate={null}
          face="sleep"
          headline={voice.headline ?? ""}
          secondary={voice.secondary ?? ""}
          actions={
            <MateLinkLineView
              voice={{ ...voice, text: null }}
              processes={null}
              projects={<a href="#projects" />}
              projectUrl="https://app.zerops.io/project/p"
              onTryNow={undefined}
            />
          }
        />,
      ),
    );
    expect(host.querySelector("h1")?.textContent).toBe("Eddy couldn't restart.");
    expect(host.querySelector("[data-arrival-sentence]")?.textContent).toBe(
      "Zerops returned an error while restarting. Eddy was last working on the build.",
    );
    const disclosure = host.querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')!;
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(host.textContent).not.toContain("500: Internal Server Error");
    await act(async () => disclosure.click());
    expect(host.textContent).toContain("500: Internal Server Error");
    expect(host.textContent).toContain("Go to projects");
    expect(host.textContent).toContain("Open in Zerops");
  } finally {
    await act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
