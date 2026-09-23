import { createMateDiagnostics } from "@t3tools/client-runtime/zerops/diagnostics";
import { describe, expect, it } from "vite-plus/test";

import { MATE_DIAGNOSTICS_FLAG, installMateDiagnostics } from "./diagnostics";

const storageWith = (flag: string | null) => ({
  getItem: (key: string) => (key === MATE_DIAGNOSTICS_FLAG ? flag : null),
});

describe("installMateDiagnostics", () => {
  for (const [name, storage, exposed] of [
    ["the flag is on", storageWith("1"), true],
    ["the flag is off", storageWith(null), false],
    ["the flag holds anything but 1", storageWith("true"), false],
    [
      "storage refuses to be read",
      {
        getItem: () => {
          throw new Error("SecurityError");
        },
      },
      false,
    ],
  ] as const) {
    it(`${exposed ? "exposes" : "hides"} the recorder when ${name}`, () => {
      const target: { __mateDiagnostics?: unknown } = {};
      const diagnostics = createMateDiagnostics({ now: () => 7 });
      installMateDiagnostics({ storage, target, diagnostics });
      diagnostics.record({ kind: "access-grant", round: 1 });
      if (!exposed) {
        expect("__mateDiagnostics" in target).toBe(false);
        expect(diagnostics.snapshot()).toEqual([]);
        return;
      }
      const view = target.__mateDiagnostics as {
        readonly snapshot: () => unknown;
        readonly clear: () => void;
      };
      expect(Object.keys(view).toSorted()).toEqual(["clear", "snapshot"]);
      expect(view.snapshot()).toEqual([{ t: 7, kind: "access-grant", round: 1 }]);
      view.clear();
      expect(view.snapshot()).toEqual([]);
    });
  }
});
