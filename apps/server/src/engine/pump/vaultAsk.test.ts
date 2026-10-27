import { describe, expect, it } from "@effect/vitest";
import type { ItemBody } from "@t3tools/contracts";

import { vaultAskOfCall, vaultStoredOfCall } from "./vaultAsk.ts";

const call = (
  resultText: string | undefined,
  patch: Partial<Extract<ItemBody, { kind: "call" }>> = {},
): ItemBody => ({
  kind: "call",
  step: "mcp",
  tool: { name: "zerops_env", server: "zerops" },
  words: null,
  state: "done",
  endedAt: 1,
  result: { toolName: "zerops_env", ...(resultText === undefined ? {} : { resultText }) },
  ...patch,
});

const requested = (fields: Record<string, unknown>) =>
  JSON.stringify({ requested: fields, nextActions: "Now waiting on the person." });

describe("a zcp call that asks the person for a value", () => {
  it.each([
    [
      "asked for Shared",
      call(
        requested({
          key: "STRIPE_SECRET_KEY",
          reason: "Stripe charges cards.",
          scope: "shared",
          sensitive: true,
        }),
      ),
      {
        kind: "vault",
        key: "STRIPE_SECRET_KEY",
        scope: { kind: "shared" },
        sensitive: true,
        reason: "Stripe charges cards.",
      },
    ],
    [
      "asked for a service's own vault",
      call(
        requested({
          key: "SUPPORT_EMAIL",
          reason: "Where replies come from.",
          scope: "service",
          serviceHostname: "api",
          sensitive: false,
        }),
      ),
      {
        kind: "vault",
        key: "SUPPORT_EMAIL",
        scope: { kind: "service", hostname: "api" },
        sensitive: false,
        reason: "Where replies come from.",
      },
    ],
    [
      "asked by a zcp that names it for people",
      call(
        requested({
          key: "STRIPE_SECRET_KEY",
          label: "Stripe secret key",
          why: "for checkout",
          scope: "shared",
          sensitive: true,
        }),
      ),
      {
        kind: "vault",
        key: "STRIPE_SECRET_KEY",
        label: "Stripe secret key",
        scope: { kind: "shared" },
        sensitive: true,
        reason: "for checkout",
      },
    ],
    [
      "asked by a zcp that does not say why",
      call(requested({ key: "API_KEY", scope: "shared", sensitive: true })),
      { kind: "vault", key: "API_KEY", scope: { kind: "shared" }, sensitive: true, reason: null },
    ],
  ])("%s: an ask of the person", (_name, body, ask) => {
    expect(vaultAskOfCall(body)).toEqual(ask);
  });

  it.each([
    [
      "a key already in that vault: nothing was asked",
      call(JSON.stringify({ alreadySet: { key: "API_KEY", scope: "shared", alreadySet: true } })),
    ],
    [
      "a call that failed",
      call(requested({ key: "API_KEY", scope: "shared", sensitive: true }), { state: "failed" }),
    ],
    [
      "another tool",
      call(requested({ key: "API_KEY", scope: "shared", sensitive: true }), {
        result: {
          toolName: "zerops_deploy",
          resultText: requested({ key: "API_KEY", scope: "shared", sensitive: true }),
        },
      }),
    ],
    ["a result over the limit", call(undefined)],
    ["a result that is not JSON", call("Error: not found")],
    [
      "a key no vault takes",
      call(requested({ key: "API_KEY=sk", scope: "shared", sensitive: true })),
    ],
    [
      "a service ask without its service",
      call(requested({ key: "API_KEY", scope: "service", sensitive: true })),
    ],
    ["a note", { kind: "note", text: "hi", streaming: false, answer: false } as ItemBody],
  ])("%s: no ask", (_name, body) => {
    expect(vaultAskOfCall(body)).toBeNull();
  });
});

const stored = (fields: Record<string, unknown>) =>
  JSON.stringify({ process: { id: "p1", status: "FINISHED" }, ...fields });

describe("a zcp call that stores values in a vault", () => {
  it.each([
    [
      "stored in Shared",
      call(stored({ stored: [{ key: "STRIPE_SECRET_KEY", value: "***" }], scope: "shared" })),
      { keys: ["STRIPE_SECRET_KEY"], scope: { kind: "shared" } },
    ],
    [
      "stored in a service's own vault",
      call(
        stored({
          stored: [
            { key: "SMTP_USER", value: "mail" },
            { key: "SMTP_PASSWORD", value: "***", replaced: true },
          ],
          scope: "service",
          serviceHostname: "api",
        }),
      ),
      { keys: ["SMTP_USER", "SMTP_PASSWORD"], scope: { kind: "service", hostname: "api" } },
    ],
  ])("%s: the keys and the vault they went to", (_name, body, values) => {
    expect(vaultStoredOfCall(body)).toEqual(values);
  });

  it.each([
    [
      "an answer that does not name its vault (a zcp before it did)",
      call(stored({ stored: [{ key: "API_KEY", value: "***" }] })),
    ],
    [
      "a service's vault without its service",
      call(stored({ stored: [{ key: "API_KEY", value: "***" }], scope: "service" })),
    ],
    ["an ask of the person", call(requested({ key: "API_KEY", scope: "shared", sensitive: true }))],
    [
      "a call that failed",
      call(stored({ stored: [{ key: "API_KEY", value: "***" }], scope: "shared" }), {
        state: "failed",
      }),
    ],
    [
      "another tool",
      call(undefined, {
        result: {
          toolName: "zerops_deploy",
          resultText: stored({ stored: [{ key: "API_KEY" }], scope: "shared" }),
        },
      }),
    ],
    ["nothing stored", call(stored({ stored: [], scope: "shared" }))],
    ["a key no vault takes", call(stored({ stored: [{ key: "API_KEY=sk" }], scope: "shared" }))],
  ])("%s: nothing stored", (_name, body) => {
    expect(vaultStoredOfCall(body)).toBeNull();
  });
});
