import { describe, expect, it } from "@effect/vitest";
import type { ItemBody } from "@t3tools/contracts";

import { originAskOfCall } from "./originAsk.ts";

const URL = "https://github.com/zeropsio/mate";

const call = (answer: unknown, toolName = "zerops_origin"): ItemBody => ({
  kind: "call",
  step: "mcp",
  tool: { name: toolName, server: "zerops" },
  words: null,
  state: "done",
  endedAt: 1,
  result: { toolName, resultText: JSON.stringify(answer) },
});

const requested = (origin: Record<string, unknown>) => ({
  requested: { origin },
  nextActions: "Now waiting on the person.",
});

describe("a zcp call that asks the person to connect an origin", () => {
  it.each([
    [
      "asked with why",
      call(requested({ url: URL, repo: "appdev", why: " Deliver work back. " })),
      { kind: "origin", url: URL, repo: "appdev", reason: "Deliver work back." },
    ],
    [
      "asked without why",
      call(requested({ url: URL, repo: "appdev" })),
      { kind: "origin", url: URL, repo: "appdev", reason: null },
    ],
    [
      "already connected: nothing to ask",
      call({ connected: { origin: { url: URL, repo: "appdev" } } }),
      null,
    ],
    [
      "an address with credentials",
      call(requested({ url: "https://x:tok@github.com/a/b", repo: "appdev" })),
      null,
    ],
    [
      "an address that is not https",
      call(requested({ url: "git@github.com:a/b.git", repo: "appdev" })),
      null,
    ],
    ["no HQ repository", call(requested({ url: URL })), null],
    ["another tool's answer", call(requested({ url: URL, repo: "appdev" }), "zerops_env"), null],
  ])("%s", (_name, body, ask) => {
    expect(originAskOfCall(body)).toEqual(ask);
  });
});
