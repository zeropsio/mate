// @vitest-environment happy-dom
import { act, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { PortalGate } from "../ui/portal-gate";
import { MateEmptyStateView } from "../zerops/ZeropsMateEmptyState";
import { MateFace, type MateFaceCue } from "../zerops/primitives/MateFace";
import {
  ConversationOpeningAvatar,
  ConversationOpeningProvider,
  ConversationOpeningLayer,
  ConversationOpeningStage,
} from "./ConversationOpeningStage";

const mate = {
  name: "Sage",
  projectId: "mate-project",
  tint: "rose",
  shape: "flower",
  project: "Ahmad Tea",
  connected: true,
} as const;
const hosts: HTMLDivElement[] = [];
afterEach(() => {
  hosts.splice(0).forEach((host) => host.remove());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function opening(ready = false, header = { cues: [] as ReadonlyArray<MateFaceCue> }) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 72, 72),
  );
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const root = createRoot(host);
  const show = async (
    ready: boolean,
    route = "link",
    hasStage = true,
    threadKey = "main",
    readPending = true,
    children?: ReactElement<{ readonly faceSlot?: ReactNode }>,
    name = "Sage",
  ) =>
    act(() =>
      root.render(
        <ConversationOpeningProvider>
          <ConversationOpeningAvatar>
            <MateFace state="idle" tint="rose" shape="flower" size="sm" cues={header.cues} />
          </ConversationOpeningAvatar>
          <section key={route}>
            {hasStage ? (
              <ConversationOpeningStage
                ready={ready}
                readPending={readPending}
                name={name}
                mate={{ ...mate, name }}
                threadKey={threadKey}
              >
                {children}
              </ConversationOpeningStage>
            ) : null}
          </section>
        </ConversationOpeningProvider>,
      ),
    );
  await show(ready);
  return { host, show, close: () => act(() => root.unmount()) };
}
async function end(node: Element | null, animationName: string) {
  await act(() =>
    node?.dispatchEvent(new AnimationEvent("animationend", { bubbles: true, animationName })),
  );
}
const phase = (host: HTMLElement) =>
  host.querySelector("[data-conversation-opening]")?.getAttribute("data-conversation-opening");

it("holds one waiting face until the conversation is ready, then opens its eyes before the conversation appears", async () => {
  const view = await opening();
  try {
    const stage = view.host.querySelector("[data-conversation-opening]");
    const face = view.host.querySelector("[data-mate-face-state]");
    expect(face?.getAttribute("data-mate-face-state")).toBe("waking");
    expect(view.host.textContent).toContain("Sage is opening the conversation.");
    await end(face, "conversation-wake");
    expect(phase(view.host)).toBe("waiting");
    await view.show(true);
    expect(phase(view.host)).toBe("wake");
    expect(view.host.querySelector("[data-conversation-opening]")).toBe(stage);
    expect(view.host.querySelector("[data-mate-face-state]")).toBe(face);
    expect(face?.getAttribute("data-mate-face-state")).toBe("idle");
    await end(stage, "unrelated-animation");
    expect(phase(view.host)).toBe("wake");
    await end(view.host.querySelector('[data-mate-face-eye="left"]'), "conversation-eye-open");
    expect(phase(view.host)).toBe("hand-off");
    await end(stage, "conversation-handoff");
    expect(phase(view.host)).toBe("complete");
    expect(view.host.querySelector("[data-conversation-avatar] [data-mate-face-state]")).toBe(face);
    expect(view.host.querySelectorAll("[data-mate-face-state]")).toHaveLength(1);
    await view.show(false);
    expect(phase(view.host)).toBe("complete");
  } finally {
    await view.close();
  }
});

it("an immediately ready conversation shows no opening stage or animation", async () => {
  const view = await opening(true);
  try {
    expect(view.host.querySelector("[data-conversation-opening]")).toBeNull();
    expect(
      view.host.querySelector("[data-opening-actor]")?.getAttribute("data-opening-actor"),
    ).toBe("complete");
  } finally {
    await view.close();
  }
});

it("keeps the same waiting stage and face when the link route hands over to an already placed conversation", async () => {
  const view = await opening();
  try {
    const face = view.host.querySelector("[data-mate-face-state]");
    const stage = view.host.querySelector("[data-conversation-opening]");
    await view.show(true, "conversation");
    expect(view.host.querySelector("[data-conversation-opening]")).toBe(stage);
    expect(view.host.querySelector("[data-mate-face-state]")).toBe(face);
    expect(phase(view.host)).toBe("wake");
  } finally {
    await view.close();
  }
});

for (const input of ["pointerdown", "keydown", "wheel", "touchmove"]) {
  it.each(
    Array.from(["wake", "hand-off"], (during) => ({
      title: `${input} immediately finishes the ${during} and leaves the conversation usable`,
      during,
    })),
  )("$title", async ({ during }) => {
    const view = await opening();
    try {
      await view.show(true);
      if (during === "hand-off")
        await end(view.host.querySelector('[data-mate-face-eye="left"]'), "conversation-eye-open");
      await act(() => document.dispatchEvent(new Event(input, { bubbles: true })));
      expect(phase(view.host)).toBe("complete");
      expect(
        view.host.querySelector("[data-conversation-avatar] [data-mate-face-state]"),
      ).not.toBeNull();
    } finally {
      await view.close();
    }
  });
}

it("reduced motion waits for real readiness, then shows open eyes and the conversation without moving", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const view = await opening();
  try {
    expect(phase(view.host)).toBe("waiting");
    await view.show(true);
    expect(phase(view.host)).toBe("complete");
    expect(
      view.host.querySelector("[data-mate-face-state]")?.getAttribute("data-mate-face-state"),
    ).toBe("idle");
  } finally {
    await view.close();
  }
});

it("turning on reduced motion during the wake finishes immediately", async () => {
  const media = new EventTarget();
  const preference = {
    matches: false,
    addEventListener: media.addEventListener.bind(media),
    removeEventListener: media.removeEventListener.bind(media),
  };
  vi.stubGlobal("matchMedia", () => preference);
  const view = await opening();
  try {
    await view.show(true);
    preference.matches = true;
    await act(() => media.dispatchEvent(new Event("change")));
    expect(phase(view.host)).toBe("complete");
  } finally {
    await view.close();
  }
});

it("a later cold conversation starts a new wait after an earlier hand-off completed", async () => {
  const view = await opening();
  try {
    await view.show(true);
    await act(() => document.dispatchEvent(new Event("keydown")));
    expect(phase(view.host)).toBe("complete");
    await view.show(false, "later-conversation");
    expect(phase(view.host)).toBe("waiting");
    expect(view.host.querySelectorAll("[data-mate-face-state]")).toHaveLength(1);
  } finally {
    await view.close();
  }
});

it("switching to a cold conversation during a wake waits for the new conversation's readiness", async () => {
  const view = await opening();
  try {
    await view.show(true);
    expect(phase(view.host)).toBe("wake");
    await view.show(false, "another-conversation");
    expect(phase(view.host)).toBe("waiting");
  } finally {
    await view.close();
  }
});

it("a suppressed pane cannot run an opening or take the visible header's face", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const root = createRoot(host);
  try {
    await act(() =>
      root.render(
        <ConversationOpeningProvider>
          <ConversationOpeningAvatar>
            <MateFace state="idle" tint="rose" />
          </ConversationOpeningAvatar>
          <section data-active-pane="">
            <ConversationOpeningStage ready={false} name="Sage" mate={mate} />
          </section>
          <PortalGate closed>
            <section hidden>
              <ConversationOpeningAvatar>
                <MateFace state="idle" tint="rose" />
              </ConversationOpeningAvatar>
              <ConversationOpeningStage ready name="Sage" mate={mate} />
            </section>
          </PortalGate>
        </ConversationOpeningProvider>,
      ),
    );
    expect(
      host
        .querySelector("[data-active-pane] [data-conversation-opening]")
        ?.getAttribute("data-conversation-opening"),
    ).toBe("waiting");
    expect(host.querySelectorAll("[data-mate-face-state]")).toHaveLength(1);
  } finally {
    await act(() => root.unmount());
  }
});

it("leaving an opening surface releases its face claim for a page with only a header", async () => {
  const view = await opening();
  try {
    await view.show(false, "another-page", false);
    expect(
      view.host.querySelector("[data-conversation-avatar] [data-mate-face-state]"),
    ).not.toBeNull();
    expect(view.host.querySelectorAll("[data-mate-face-state]")).toHaveLength(1);
  } finally {
    await view.close();
  }
});

it("switching from a waiting conversation to a different warm conversation skips the waiting pose and wake", async () => {
  const view = await opening();
  try {
    await view.show(true, "warm-conversation", true, "another-thread");
    expect(view.host.querySelector("[data-conversation-opening]")).toBeNull();
    expect(
      view.host.querySelector("[data-conversation-avatar] [data-mate-face-state]"),
    ).not.toBeNull();
  } finally {
    await view.close();
  }
});

it("the stage owns the wake without replaying opening cues on landing, and the avatar still greets later events", async () => {
  const header = {
    cues: [{ moment: "peek", key: "opened", arrives: true }] as ReadonlyArray<MateFaceCue>,
  };
  const view = await opening(false, header);
  try {
    await view.show(true);
    await end(view.host.querySelector('[data-mate-face-eye="left"]'), "conversation-eye-open");
    await end(view.host.querySelector("[data-conversation-opening]"), "conversation-handoff");
    const face = view.host.querySelector("[data-mate-face-state]");
    expect(face?.hasAttribute("data-mate-face-moment")).toBe(false);
    header.cues = [{ moment: "dance", key: "later-success" }];
    await view.show(true);
    expect(face?.getAttribute("data-mate-face-moment")).toBe("dance");
  } finally {
    await view.close();
  }
});

it("placement, live-follow and hidden-pane scrolls cannot cancel the wake or hand-off", async () => {
  const view = await opening();
  try {
    await view.show(true);
    for (const during of ["wake", "hand-off"]) {
      await act(() => {
        document.dispatchEvent(new Event("scroll"));
        view.host.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      expect(phase(view.host)).toBe(during);
      await end(view.host.querySelector('[data-mate-face-eye="left"]'), "conversation-eye-open");
    }
  } finally {
    await view.close();
  }
});

it("a warm source shows no waiting pose while its list proves placement", async () => {
  const view = await opening();
  try {
    await view.show(false, "warm-conversation", true, "warm-thread", false);
    expect(view.host.querySelector("[data-conversation-opening]")).toBeNull();
    expect(
      view.host.querySelector('[data-conversation-avatar] [data-mate-face-state="idle"]'),
    ).not.toBeNull();
    await view.show(true, "warm-conversation", true, "warm-thread", false);
    expect(view.host.querySelector("[data-conversation-opening]")).toBeNull();
  } finally {
    await view.close();
  }
});

it.each(
  Array.from([true, false], (restarting) => ({
    title: `the ${restarting ? "restart" : "stand-up"} composition transfers its actual face to an already placed conversation`,
    restarting,
  })),
)("$title", async ({ restarting }) => {
  const view = await opening();
  try {
    await view.show(
      false,
      "source",
      true,
      "main",
      true,
      <MateEmptyStateView
        mate={mate}
        phase={null}
        coming={{
          kind: restarting ? "reaching" : "coming",
          restarting,
          headline: restarting ? "Restarting Sage" : "Sage is standing up",
          below: <button>Inspect progress</button>,
        }}
        signIn={null}
        signInRequired={false}
        unknown={null}
      />,
    );
    const face = view.host.querySelector("[data-mate-face-state]");
    const lead = view.host.querySelector("[data-mate-empty-lead]");
    expect(view.host.querySelectorAll("[data-mate-face-state]")).toHaveLength(1);
    expect(view.host.textContent).toContain(restarting ? "Restarting Sage" : "Sage is standing up");
    await view.show(true, "conversation");
    expect(phase(view.host)).toBe("wake");
    expect(view.host.textContent).toContain(restarting ? "Restarting Sage" : "Sage is standing up");
    expect(view.host.textContent).toContain("Inspect progress");
    expect(view.host.querySelector("[data-mate-empty-lead]")).toBe(lead);
    expect(view.host.querySelector("[data-mate-face-state]")).toBe(face);
    await end(view.host.querySelector('[data-mate-face-eye="left"]'), "conversation-eye-open");
    await end(view.host.querySelector("[data-conversation-opening]"), "conversation-handoff");
    expect(view.host.querySelector("[data-conversation-avatar] [data-mate-face-state]")).toBe(face);
  } finally {
    await view.close();
  }
});

it.each(
  Array.from(["unreachable", "reaching"] as const, (kind) => ({
    title: `a warm skip does not suppress a later ${kind} message or its recovery actions`,
    kind,
  })),
)("$title", async ({ kind }) => {
  const view = await opening();
  const recover = vi.fn();
  try {
    await view.show(false, "warm", true, "warm-thread", false);
    expect(view.host.querySelector("[data-conversation-opening]")).toBeNull();
    await view.show(
      false,
      "warm",
      true,
      "warm-thread",
      false,
      <MateEmptyStateView
        mate={mate}
        phase={null}
        signIn={null}
        signInRequired={false}
        unknown={null}
        coming={{
          kind,
          headline: "Sage cannot be reached",
          below: <button onClick={recover}>Try again</button>,
        }}
      />,
    );
    expect(phase(view.host)).toBe("waiting");
    expect(view.host.textContent).toContain("Sage cannot be reached");
    const action = view.host.querySelector("button");
    expect(action).not.toBeNull();
    await act(() => action?.click());
    expect(recover).toHaveBeenCalledOnce();
  } finally {
    await view.close();
  }
});

it("leaving a pending opening ends its lifetime; returning to that ready thread skips it", async () => {
  const view = await opening();
  try {
    await view.show(false, "projects", false);
    await view.show(true, "conversation", true, "main", false);
    expect(view.host.querySelector("[data-conversation-opening]")).toBeNull();
    expect(
      view.host.querySelector('[data-conversation-avatar] [data-mate-face-state="idle"]'),
    ).not.toBeNull();
  } finally {
    await view.close();
  }
});

it.each(
  Array.from(["Renamed Sage", "@backend"], (renamed) => ({
    title: `keeps the same Mate face through readiness when the display name becomes ${renamed}`,
    renamed,
  })),
)("$title", async ({ renamed }) => {
  const view = await opening();
  try {
    const face = view.host.querySelector("[data-mate-face-state]");
    await view.show(true, "conversation", true, "main", true, undefined, renamed);
    expect(phase(view.host)).toBe("wake");
    expect(view.host.textContent).toContain("Sage is opening the conversation.");
    expect(view.host.textContent).not.toContain(`${renamed} is opening`);
    expect(view.host.querySelector("[data-mate-face-state]")).toBe(face);
    await end(view.host.querySelector('[data-mate-face-eye="left"]'), "conversation-eye-open");
    expect(phase(view.host)).toBe("hand-off");
    await end(view.host.querySelector("[data-conversation-opening]"), "conversation-handoff");
    expect(view.host.querySelector("[data-conversation-avatar] [data-mate-face-state]")).toBe(face);
  } finally {
    await view.close();
  }
});

it("keeps the opening face visible and interactive outside a withheld settling pane", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const root = createRoot(host);
  const show = async (settling: boolean) =>
    act(() =>
      root.render(
        <ConversationOpeningProvider>
          <ConversationOpeningAvatar>
            <MateFace state="idle" tint="rose" size="sm" />
          </ConversationOpeningAvatar>
          <ConversationOpeningLayer>
            <div
              className={settling ? "invisible" : undefined}
              inert={settling}
              data-settling-pane=""
            >
              <ConversationOpeningStage ready={false} name="Sage" mate={mate} />
            </div>
          </ConversationOpeningLayer>
        </ConversationOpeningProvider>,
      ),
    );
  try {
    await show(true);
    const face = host.querySelector("[data-mate-face-state]");
    expect(face).not.toBeNull();
    expect(face?.closest("[inert], .invisible")).toBeNull();
    expect(
      host.querySelector("[data-conversation-opening]")?.closest("[data-settling-pane]"),
    ).toBeNull();
    await show(false);
    expect(host.querySelector("[data-mate-face-state]")).toBe(face);
  } finally {
    await act(() => root.unmount());
  }
});

it("a prolonged restart keeps its native face cycle and advances recovery copy before readiness", async () => {
  const view = await opening();
  try {
    await view.show(
      false,
      "restart",
      true,
      "main",
      true,
      <MateEmptyStateView
        mate={mate}
        phase={null}
        coming={{ kind: "reaching", restarting: true, below: null }}
        signIn={null}
        signInRequired={false}
        unknown={null}
      />,
    );
    const face = view.host.querySelector("[data-mate-face-state]");
    const line = () =>
      view.host.querySelector('[data-arrival-sentence] [data-swap-layer="shown"]')?.textContent;
    const before = line();
    expect(face?.hasAttribute("data-mate-face-restarting")).toBe(true);
    await act(() =>
      face?.dispatchEvent(
        new AnimationEvent("animationiteration", {
          bubbles: true,
          animationName: "mate-face-restart-shake",
        }),
      ),
    );
    expect(line()).not.toBe(before);
    expect(phase(view.host)).toBe("waiting");
    expect(view.host.querySelector("[data-mate-face-state]")).toBe(face);
    await view.show(false, "restart");
    expect(view.host.querySelector("[data-mate-face-state]")).toBe(face);
    expect(view.host.textContent).toContain("Sage is opening the conversation.");
    await view.show(true, "conversation");
    expect(face?.hasAttribute("data-mate-face-restarting")).toBe(false);
    expect(phase(view.host)).toBe("wake");
    expect(view.host.querySelector("[data-mate-face-state]")).toBe(face);
  } finally {
    await view.close();
  }
});

it("finishes existing source acting when readiness hands the face to the short wake beat", async () => {
  const view = await opening();
  const source = (face: "working" | "done") => (
    <MateEmptyStateView
      mate={mate}
      phase={null}
      coming={{ kind: "reaching", face, below: null }}
      signIn={null}
      signInRequired={false}
      unknown={null}
    />
  );
  try {
    await view.show(false, "source", true, "main", true, source("working"));
    const face = view.host.querySelector("[data-mate-face-state]");
    await view.show(false, "source", true, "main", true, source("done"));
    expect(face?.getAttribute("data-mate-face-moment")).toBe("dance");
    await view.show(true, "conversation");
    expect(phase(view.host)).toBe("wake");
    expect(view.host.querySelector("[data-mate-face-state]")).toBe(face);
    expect(face?.getAttribute("data-mate-face-moment")).toBeNull();
  } finally {
    await view.close();
  }
});

it("preserves a named, dated Claude refusal while history is opening", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(() =>
      root.render(
        <ConversationOpeningStage
          ready={false}
          name="Sage"
          mate={null}
          activity={{
            threadId: "opening" as import("@t3tools/contracts").ThreadId,
            kind: "idle",
            status: null,
            face: "sleep",
            subject: undefined,
            snippet: undefined,
            at: "2026-10-07T12:00:00.000Z",
            unread: false,
            pausedUntil: undefined,
            threadKey: "opening",
            task: undefined,
            limitHistory: { provider: "Claude", resetsAt: "2026-10-10T00:00:00.000Z" },
            lastKnown: {
              kind: "failed",
              at: "2026-10-07T12:00:00.000Z",
              usageLimited: true,
              pausedUntil: "2026-10-10T00:00:00.000Z",
            },
          }}
        />,
      ),
    );
    expect(host.textContent).toContain("Sage is opening the conversation.");
    expect(host.textContent).toContain("Last known");
    expect(host.textContent).toContain("Sage hit the Claude limit");
    expect(host.textContent).toContain("Oct 10, 2026");
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
