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
  const update = (next: ObserveCredentialRead) =>
    act(() =>
      root.render(
        <ObserveCredentialControlBody
          state={next}
          available={available}
          again={() => calls.push("read")}
          personName={(id) => (id === "person" ? "Ada" : undefined)}
        />,
      ),
    );
  await update(state);
  return {
    container,
    calls,
    update,
    buttons: () => Array.from(container.querySelectorAll("button")),
    close: async () => {
      await act(() => root.unmount());
      container.remove();
    },
  };
}
describe("explicit observe authorization control", () => {
  it.each([AUTH, NONE])(
    "opening Observe status never offers authorization or revocation",
    async (value) => {
      const r = await render({ metadata: { state: "known", value, stale: false } });
      try {
        expect(r.buttons().map((button) => button.textContent?.trim())).toEqual(["Refresh"]);
        expect(r.calls).toEqual([]);
        expect(r.container.textContent).toContain(
          value.authorized ? "Authorized" : "Not authorized",
        );
        if (value.authorized) {
          expect(r.container.textContent).toContain("Authorized by Ada");
          expect(r.container.textContent).toContain(new Date(AUTH.expiresAt).toLocaleString());
        } else {
          expect(r.container.textContent).not.toContain("Authorized by");
        }
        await act(() => r.buttons()[0]!.click());
        expect(r.calls).toEqual(["read"]);
      } finally {
        await r.close();
      }
    },
  );
  it.each([
    {
      label: "unread",
      metadata: { state: "unread" },
      words: "Reading authorization…",
      available: true,
      buttons: 1,
      disabled: true,
    },
    {
      label: "reading",
      metadata: { state: "reading" },
      words: "Reading authorization…",
      available: true,
      buttons: 1,
      disabled: true,
    },
    {
      label: "unavailable",
      metadata: { state: "unread" },
      words: "Observe authorization is unavailable.",
      available: false,
      buttons: 0,
      disabled: false,
    },
    {
      label: "refused",
      metadata: { state: "failed", words: "Not allowed" },
      words: "Not allowed",
      available: true,
      buttons: 1,
      disabled: false,
    },
    {
      label: "withheld",
      metadata: { state: "withheld" },
      words: "You cannot read this authorization.",
      available: true,
      buttons: 1,
      disabled: false,
    },
  ] satisfies ReadonlyArray<{
    label: string;
    metadata: ObserveCredentialRead["metadata"];
    words: string;
    available: boolean;
    buttons: number;
    disabled: boolean;
  }>)(
    "$label status preserves uncertainty without offering authority controls",
    async ({ metadata, words, available, buttons, disabled }) => {
      const r = await render({ metadata }, available);
      try {
        expect(r.container.textContent).toContain(words);
        expect(r.container.textContent).not.toContain("Authorized by");
        expect(r.buttons().length).toBe(buttons);
        expect(r.buttons().map((button) => button.textContent?.trim())).toEqual(
          buttons ? ["Refresh"] : [],
        );
        if (buttons) expect(r.buttons()[0]!.disabled).toBe(disabled);
        expect(r.calls).toEqual([]);
      } finally {
        await r.close();
      }
    },
  );
  it("stale Observe metadata stays labelled last known and can only be refreshed", async () => {
    const r = await render({ metadata: { state: "known", value: AUTH, stale: true } });
    try {
      expect(r.container.textContent).toContain("Authorized · Last known state");
      expect(r.container.textContent).toContain("Authorized by Ada");
      expect(r.container.textContent).toContain(new Date(AUTH.expiresAt).toLocaleString());
      expect(r.buttons().map((button) => button.textContent?.trim())).toEqual(["Refresh"]);
      await act(() => r.buttons()[0]!.click());
      expect(r.calls).toEqual(["read"]);
    } finally {
      await r.close();
    }
  });
  it("metadata arriving after first paint shows its authorizer and expiry without issuing access", async () => {
    const r = await render({ metadata: { state: "reading" } });
    try {
      expect(r.container.textContent).toContain("Reading authorization…");
      expect(r.buttons()[0]!.disabled).toBe(true);
      await r.update({ metadata: { state: "known", value: AUTH, stale: false } });
      expect(r.container.textContent).not.toContain("Reading authorization…");
      expect(r.container.textContent).toContain("Authorized by Ada");
      expect(r.container.textContent).toContain(new Date(AUTH.expiresAt).toLocaleString());
      expect(r.buttons().map((button) => button.textContent?.trim())).toEqual(["Refresh"]);
      expect(r.buttons()[0]!.disabled).toBe(false);
      expect(r.calls).toEqual([]);
    } finally {
      await r.close();
    }
  });
});
