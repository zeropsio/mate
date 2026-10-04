import { act } from "react";
import { create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { closeAccountLifetime, openAccountLifetime } from "~/zerops/accountLifetime";
import { lastRowRisen, useRememberRisenRows } from "./rowRiseMemory";

type Row = { readonly groupId: string; readonly rises: boolean; readonly known: boolean };

function Remember({ rows }: { readonly rows: ReadonlyArray<Row> }) {
  useRememberRisenRows(rows);
  return null;
}

function draw(rows: ReadonlyArray<Row>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  act(() => {
    create(<Remember rows={rows} />);
  });
}

describe("which rows were last drawn risen", () => {
  afterEach(() => {
    closeAccountLifetime();
    vi.unstubAllGlobals();
  });

  it("recalls nothing for a row never drawn", () => {
    openAccountLifetime("risen-a");
    expect(lastRowRisen("g-never")).toBeUndefined();
  });

  it("recalls a row drawn risen once its answer is known, and forgets it once it settles", () => {
    openAccountLifetime("risen-a");
    draw([
      { groupId: "g-1", rises: true, known: true },
      { groupId: "g-2", rises: true, known: false },
    ]);
    expect(lastRowRisen("g-1")).toBe(true);
    // Its answer still out: nothing is remembered of it either way.
    expect(lastRowRisen("g-2")).toBeUndefined();
    draw([{ groupId: "g-1", rises: false, known: true }]);
    expect(lastRowRisen("g-1")).toBeUndefined();
  });

  it("forgets every row when the account's lifetime closes", () => {
    openAccountLifetime("risen-a");
    draw([{ groupId: "g-1", rises: true, known: true }]);
    openAccountLifetime("risen-b");
    expect(lastRowRisen("g-1")).toBeUndefined();
  });
});
