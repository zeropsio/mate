// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vite-plus/test";
import type { ObserveCredentialRead } from "@t3tools/client-runtime/data";
import type { ObserveAuthorizePress } from "~/zerops/useObserveAuthorization";
import { ObserveLineBody } from "./ObserveCredentialControl";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const AUTH = { authorized: true, userId: "person", expiresAt: "2026-11-28T10:00:00Z" };
const NONE = { authorized: false, userId: null, expiresAt: null };
const UNTIL = new Date(AUTH.expiresAt).toLocaleDateString(undefined, {
  day: "numeric",
  month: "short",
});
async function render(
  state: ObserveCredentialRead,
  available = true,
  options: { readonly offered?: boolean; readonly press?: ObserveAuthorizePress | null } = {},
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const calls: string[] = [];
  const update = (next: ObserveCredentialRead, press = options.press ?? null) =>
    act(() =>
      root.render(
        <ObserveLineBody
          authorize={options.offered ? () => calls.push("authorize") : null}
          available={available}
          personName={(id) => (id === "person" ? "Ada" : undefined)}
          press={press}
          state={next}
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
describe("whose permissions the Zerops tools observe stage and production with", () => {
  it("the Zerops row says whose permissions it reads them with and until when, offering Renew to who may", async () => {
    const r = await render({ metadata: { state: "known", value: AUTH, stale: false } }, true, {
      offered: true,
    });
    try {
      expect(r.container.textContent).toBe(`Reads them as Ada · until ${UNTIL} · Renew`);
      await act(() => r.buttons()[0]!.click());
      expect(r.calls).toEqual(["authorize"]);
    } finally {
      await r.close();
    }
  });
  it.each([
    { label: "reading", metadata: { state: "reading" }, words: "Reading…", available: true },
    {
      label: "unavailable",
      metadata: { state: "unread" },
      words: "Unavailable here",
      available: false,
    },
    {
      label: "refused",
      metadata: { state: "failed", words: "Not allowed" },
      words: "Not allowed",
      available: true,
    },
    {
      label: "withheld",
      metadata: { state: "withheld" },
      words: "You can't read whose permissions these are.",
      available: true,
    },
  ] satisfies ReadonlyArray<{
    label: string;
    metadata: ObserveCredentialRead["metadata"];
    words: string;
    available: boolean;
  }>)(
    "observation that is $label says so, and offers no authority to someone it can't vouch for",
    async ({ metadata, words, available }) => {
      const r = await render({ metadata }, available, { offered: true });
      try {
        expect(r.container.textContent).toBe(words);
        expect(r.buttons()).toEqual([]);
      } finally {
        await r.close();
      }
    },
  );
  it("a viewer who may operate an unauthorized Mate authorizes it and sees HQ's refusal words", async () => {
    const state = { metadata: { state: "known", value: NONE, stale: false } } as const;
    const r = await render(state, true, { offered: true });
    try {
      expect(r.container.textContent).toBe("Not authorized · Authorize");
      await act(() => r.buttons()[0]!.click());
      expect(r.calls).toEqual(["authorize"]);
      await r.update(state, { state: "working" });
      expect(r.buttons()[0]!.disabled).toBe(true);
      await r.update(state, {
        state: "refused",
        words: "Another person already authorized this Mate.",
      });
      expect(r.container.querySelector("[role=alert]")?.textContent).toBe(
        "Another person already authorized this Mate.",
      );
      expect(r.buttons()[0]!.disabled).toBe(false);
    } finally {
      await r.close();
    }
  });
  it("stale observation stays labelled last known", async () => {
    const r = await render({ metadata: { state: "known", value: AUTH, stale: true } });
    try {
      expect(r.container.textContent).toBe(`Reads them as Ada · until ${UNTIL} · last known`);
    } finally {
      await r.close();
    }
  });
  it("metadata arriving after first paint shows its authorizer and expiry without issuing access", async () => {
    const r = await render({ metadata: { state: "reading" } });
    try {
      expect(r.container.textContent).toBe("Reading…");
      await r.update({ metadata: { state: "known", value: AUTH, stale: false } });
      expect(r.container.textContent).toBe(`Reads them as Ada · until ${UNTIL}`);
      expect(r.calls).toEqual([]);
    } finally {
      await r.close();
    }
  });
});
