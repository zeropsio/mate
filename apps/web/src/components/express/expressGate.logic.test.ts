import { describe, expect, it } from "vite-plus/test";

import { expressGate } from "./expressGate.logic";

describe("the Adobe Express Labs switch", () => {
  it.each([
    { title: "Express stays hidden while its switch is off", on: false, key: "k", gate: "off" },
    {
      title: "Express stays hidden while its switch is off, whatever the build",
      on: false,
      key: null,
      gate: "off",
    },
    {
      title: "Express shows once its switch is on in a build with Adobe's key",
      on: true,
      key: "k",
      gate: "on",
    },
    {
      title: "Express stays hidden in a build without Adobe's key, even with its switch on",
      on: true,
      key: null,
      gate: "missing-key",
    },
  ] as const)("$title", ({ on, key, gate }) => {
    expect(expressGate(on, key)).toBe(gate);
  });
});
