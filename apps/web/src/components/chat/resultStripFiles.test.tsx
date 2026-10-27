import { act } from "react";
import { create } from "react-test-renderer";
import { describe, expect, it } from "vite-plus/test";

import { publishStripFiles, useStripFiles } from "./resultStripFiles";

// Pass 43's review: an opened card drew a picture its result's strip drew too. The card now reads
// what the strip itself drew, by its turn; until the result has said, its own guess.
describe("the files a turn's strip draws", () => {
  it("reads its guess until the result says, then the result's set, for its own turn only", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const guess = new Set(["/s/0.png", "/s/1.png"]);
    const seen: Array<ReadonlyArray<string>> = [];
    function Card() {
      seen.push([...useStripFiles("turn-1", guess)]);
      return null;
    }
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(<Card />);
    });
    expect(seen.at(-1)).toEqual(["/s/0.png", "/s/1.png"]);
    act(() => publishStripFiles("turn-2", new Set(["/s/9.png"])));
    expect(seen.at(-1)).toEqual(["/s/0.png", "/s/1.png"]);
    act(() => publishStripFiles("turn-1", new Set(["/s/0.png", "/s/2.png"])));
    expect(seen.at(-1)).toEqual(["/s/0.png", "/s/2.png"]);
    act(() => renderer.unmount());
  });
});
