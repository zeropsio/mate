// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vite-plus/test";
import type { ObserveCredentialRead } from "@t3tools/client-runtime/data";
import { ObserveCredentialControlBody } from "./ObserveCredentialControl";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const AUTH = { authorized: true, userId: "person", expiresAt: "2026-11-28T10:00:00Z" };
const NONE = { authorized: false, userId: null, expiresAt: null };
async function render(state: ObserveCredentialRead, available = true) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const calls: string[] = [];
  await act(() =>
    root.render(
      <ObserveCredentialControlBody
        state={state}
        available={available}
        authorize={() => calls.push("authorize")}
        revoke={() => calls.push("revoke")}
        again={() => calls.push("read")}
        personName={(id) => (id === "person" ? "Ada" : undefined)}
      />,
    ),
  );
  return {
    container,
    calls,
    button: (name: string) =>
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === name,
      ),
    close: async () => {
      await act(() => root.unmount());
      container.remove();
    },
  };
}
describe("explicit observe authorization control", () => {
  it("opening shows authorization, person and expiry without granting until a person presses", async () => {
    const r = await render({
      metadata: { state: "known", value: AUTH, stale: false },
      action: { kind: "idle" },
    });
    try {
      expect(r.calls).toEqual([]);
      expect(r.container.textContent).toContain("Authorized by Ada");
      expect(r.container.textContent).toContain(new Date(AUTH.expiresAt).toLocaleString());
      await act(() => r.button("Reauthorize")!.click());
      await act(() => r.button("Revoke")!.click());
      expect(r.calls).toEqual(["authorize", "revoke"]);
    } finally {
      await r.close();
    }
  });
  it("an unauthorized profile offers an explicit authorization action", async () => {
    const r = await render({
      metadata: { state: "known", value: NONE, stale: false },
      action: { kind: "idle" },
    });
    try {
      expect(r.container.textContent).toContain("Not authorized");
      expect(r.button("Revoke")).toBeUndefined();
      await act(() => r.button("Authorize Zerops Control Plane")!.click());
      expect(r.calls).toEqual(["authorize"]);
    } finally {
      await r.close();
    }
  });
  it.each([
    {
      label: "reading",
      state: { metadata: { state: "reading" }, action: { kind: "idle" } } as ObserveCredentialRead,
      words: "Reading authorization…",
      available: true,
    },
    {
      label: "unavailable",
      state: { metadata: { state: "unread" }, action: { kind: "idle" } } as ObserveCredentialRead,
      words: "Observe authorization is unavailable.",
      available: false,
    },
    {
      label: "refused",
      state: {
        metadata: { state: "failed", words: "Not allowed" },
        action: { kind: "idle" },
      } as ObserveCredentialRead,
      words: "Not allowed",
      available: true,
    },
    {
      label: "busy",
      state: {
        metadata: { state: "known", value: NONE, stale: false },
        action: { kind: "working", verb: "authorize" },
      } as ObserveCredentialRead,
      words: "Not authorized",
      available: true,
    },
  ])(
    "$label never looks authorized and disables authorization",
    async ({ state, words, available }) => {
      const r = await render(state, available);
      try {
        expect(r.container.textContent).toContain(words);
        expect(r.button("Authorize Zerops Control Plane")?.disabled).toBe(true);
        expect(r.calls).toEqual([]);
      } finally {
        await r.close();
      }
    },
  );
  it("a stale record is labelled last known and uncertain writes retain the way to revoke", async () => {
    const r = await render({
      metadata: { state: "known", value: AUTH, stale: true },
      action: { kind: "unresolved", words: "Outcome unresolved" },
    });
    try {
      expect(r.container.textContent).toContain("Last known state");
      expect(r.container.textContent).toContain("Outcome unresolved");
      expect(r.button("Reauthorize")?.disabled).toBe(true);
      expect(r.button("Revoke")?.disabled).toBe(false);
      await act(() => r.button("Revoke")!.click());
      expect(r.calls).toEqual(["revoke"]);
    } finally {
      await r.close();
    }
  });
});
