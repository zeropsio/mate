import { describe, expect, it } from "vite-plus/test";

import origin from "./__fixtures__/originMateFaces.json" with { type: "json" };
import {
  MATE_SHAPE_IDS,
  MATE_SHAPES,
  MATE_SHAPE_OF_TINT,
  MATE_TINT_IDS,
  MATE_TINTS,
} from "./brand.ts";
import { formatMateFace, readMateFace } from "./mateFaces.ts";

describe("origin's face vocabulary through HQ", () => {
  it("preserves every origin tint, shape, and default pair", () => {
    expect({ MATE_TINT_IDS, MATE_TINTS, MATE_SHAPE_IDS, MATE_SHAPES, MATE_SHAPE_OF_TINT }).toEqual({
      MATE_TINT_IDS: origin.MATE_TINT_IDS,
      MATE_TINTS: origin.MATE_TINTS,
      MATE_SHAPE_IDS: origin.MATE_SHAPE_IDS,
      MATE_SHAPES: origin.MATE_SHAPES,
      MATE_SHAPE_OF_TINT: origin.MATE_SHAPE_OF_TINT,
    });
  });

  it.each(MATE_TINT_IDS)("round trips %s with every origin silhouette", (tint) => {
    for (const shape of MATE_SHAPE_IDS) {
      expect(readMateFace(formatMateFace({ tint, shape }))).toEqual({ tint, shape });
      expect(readMateFace(formatMateFace({ tint, shape }, { named: true }))).toEqual({
        tint,
        shape,
        named: true,
      });
    }
  });

  it("reads the known parts of newer faces as origin does", () => {
    expect(readMateFace("sky:future:named:extra")).toEqual({
      tint: "sky",
      shape: undefined,
      named: true,
    });
    expect(readMateFace("future:gem")).toEqual({ tint: undefined, shape: "gem" });
    expect(readMateFace("future:future")).toBeUndefined();
    expect(readMateFace("mate:face:sky:pick")).toBeUndefined();
  });
});
