import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { RunShimmer } from "./RunShimmer";

/** The text of every element carrying `attribute`, tags stripped. */
function textsOf(html: string, attribute: string): ReadonlyArray<string> {
  const texts: Array<string> = [];
  for (const match of html.matchAll(new RegExp(`<span [^>]*${attribute}[^>]*>`, "gu"))) {
    let depth = 0;
    const at = match.index;
    const tag = /<\/?span\b[^>]*>/gu;
    tag.lastIndex = at;
    for (let next = tag.exec(html); next !== null; next = tag.exec(html)) {
      depth += next[0].startsWith("</") ? -1 : 1;
      if (depth === 0) {
        texts.push(html.slice(at, next.index + next[0].length).replace(/<[^>]+>/gu, ""));
        break;
      }
    }
  }
  return texts;
}

const words = (
  <>
    Reading <span className="run-now-mono">server.ts</span>
  </>
);

describe("RunShimmer", () => {
  it.each<[string, boolean, boolean, boolean]>([
    ["a call running in a block", true, false, false],
    ["a call running on a cut line", true, true, true],
    ["a call returned", false, false, false],
    ["a call returned on a cut line", false, true, false],
  ])("%s: sweeps only while it runs", (_, sweeps, inline, cut) => {
    const html = renderToStaticMarkup(
      <RunShimmer inline={inline} sweeps={sweeps}>
        {words}
      </RunShimmer>,
    );
    expect(html.includes('data-run-shimmer=""')).toBe(sweeps);
    expect(html.includes("data-sweep-cut")).toBe(cut);
    expect(html.includes("data-sweep-band")).toBe(sweeps);
  });

  // The light is a copy of the words sliding with it: it says the same thing, and says it to
  // nobody — no reader hears the words twice, no tab stops in it, no find or selection lands in it.
  it("lights a copy of the same words that is hidden from readers and from input", () => {
    const html = renderToStaticMarkup(<RunShimmer sweeps>{words}</RunShimmer>);
    expect(textsOf(html, "data-sweep-words")).toEqual(["Reading server.ts"]);
    expect(textsOf(html, "data-sweep-copy")).toEqual(["Reading server.ts"]);
    const band = /<span [^>]*data-sweep-band[^>]*>/u.exec(html)?.[0] ?? "";
    expect(band).toContain('aria-hidden="true"');
    expect(band).toContain('inert=""');
    // The copy keeps the words' own parts, so it sets them exactly where they stand.
    expect(html.match(/class="run-now-mono"/gu)).toHaveLength(2);
  });

  it("keeps the words in the same place whether it sweeps or not", () => {
    const still = renderToStaticMarkup(<RunShimmer sweeps={false}>{words}</RunShimmer>);
    const sweeping = renderToStaticMarkup(<RunShimmer sweeps>{words}</RunShimmer>);
    expect(textsOf(still, "data-sweep-words")).toEqual(textsOf(sweeping, "data-sweep-words"));
  });
});
