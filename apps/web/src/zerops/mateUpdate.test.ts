import { describe, expect, it } from "vite-plus/test";

import { mateUpdateLine } from "./mateUpdate";

describe("mateUpdateLine", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly update: Parameters<typeof mateUpdateLine>[0];
    readonly serverVersion: string;
    readonly expected: ReturnType<typeof mateUpdateLine>;
  }> = [
    {
      name: "no update field (standalone server, or zcp unreachable): the installed version alone",
      update: undefined,
      serverVersion: "0.8.0",
      expected: { text: "Server 0.8.0", tone: "default" },
    },
    {
      name: "checked, nothing newer: the installed version alone, no suffix",
      update: {
        installed: "0.8.1",
        latest: "0.8.1",
        available: false,
        checkedAt: "2026-09-09T00:00:00Z",
      },
      serverVersion: "0.8.0",
      expected: { text: "Server 0.8.1", tone: "default" },
    },
    {
      name: "an update is available: installed, then the newer version in the attention tone",
      update: {
        installed: "0.8.0",
        latest: "0.8.1",
        available: true,
        checkedAt: "2026-09-09T00:00:00Z",
      },
      serverVersion: "0.8.0",
      expected: { text: "Server 0.8.0 · 0.8.1 available", tone: "attention" },
    },
  ];

  for (const { name, update, serverVersion, expected } of cases) {
    it(name, () => {
      expect(mateUpdateLine(update, serverVersion)).toEqual(expected);
    });
  }
});
