import { expect, it } from "vite-plus/test";
import { pressureOf } from "./mateResourceEvidence.ts";

it.each(["avg60", "avg300"])(
  "Invalid %s evidence is rejected instead of becoming a notice",
  (average) => {
    for (const value of ["", "NaN", "-1", "101"])
      expect(() => pressureOf(`some avg10=5 ${average}=${value} total=3`)).toThrow("Invalid PSI");
  },
);
