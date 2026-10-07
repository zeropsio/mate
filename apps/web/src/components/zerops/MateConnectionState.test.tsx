// @vitest-environment happy-dom
import type { Reachability } from "@t3tools/client-runtime/zerops/environments";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import { mateNoticeVoice } from "../../zerops/mateNoticeVoice";
import { MateLinkLineView } from "./MateLinkLine";
import { MateConnectionState } from "./ZeropsMateEmptyState";

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
      expect(host.querySelector("h1")?.textContent).toBe("Rosa is opening the conversation.");
      expect(host.textContent).toContain("Waiting for the conversation to be read.");
      expect(host.querySelector("button")).toBeNull();
      expect(host.textContent).not.toContain("Project services");
    }
    await show({ kind: "not-answering", overdue: false });
    expect(host.querySelector("h1")?.textContent).toBe("Rosa isn't answering.");
    expect(host.querySelector("button")?.textContent).toBe("Try now");
    await act(() => host.querySelector<HTMLButtonElement>("button")!.click());
    expect(retry).toHaveBeenCalledOnce();
    await show({ kind: "connecting", waitingOn: "exchange" });
    expect(host.querySelector("button")).toBeNull();
    expect(host.querySelector("h1")?.textContent).toBe("Rosa is opening the conversation.");
  } finally {
    await act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
