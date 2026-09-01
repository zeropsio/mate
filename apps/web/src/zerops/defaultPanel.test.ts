import { describe, expect, it } from "vite-plus/test";

import { resolveDefaultZeropsPanel } from "./defaultPanel";

describe("resolveDefaultZeropsPanel", () => {
  it.each([
    {
      name: "opens once for available Zerops topology on wide web",
      input: {
        topology: "available" as const,
        usesSheet: false,
        handled: false,
        hasPriorPanelChoice: false,
      },
      expected: "open",
    },
    {
      name: "remembers an existing panel choice without replacing it",
      input: {
        topology: "available" as const,
        usesSheet: false,
        handled: false,
        hasPriorPanelChoice: true,
      },
      expected: "remember",
    },
    {
      name: "waits after this thread already handled the default",
      input: {
        topology: "available" as const,
        usesSheet: false,
        handled: true,
        hasPriorPanelChoice: false,
      },
      expected: "wait",
    },
    {
      name: "waits on a narrow layout",
      input: {
        topology: "available" as const,
        usesSheet: true,
        handled: false,
        hasPriorPanelChoice: false,
      },
      expected: "wait",
    },
    {
      name: "waits for unresolved topology",
      input: {
        topology: "unknown" as const,
        usesSheet: false,
        handled: false,
        hasPriorPanelChoice: false,
      },
      expected: "wait",
    },
    {
      name: "waits when Zerops is unavailable",
      input: {
        topology: "unavailable" as const,
        usesSheet: false,
        handled: false,
        hasPriorPanelChoice: false,
      },
      expected: "wait",
    },
  ])("$name", ({ input, expected }) => {
    expect(resolveDefaultZeropsPanel(input)).toBe(expected);
  });
});
