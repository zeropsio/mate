import { markupDom } from "../../../test/markupDom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { RunShimmer } from "./RunShimmer";

const words = (
  <>
    Reading <span className="run-now-mono">server.ts</span>
  </>
);

describe("RunShimmer", () => {
  // The light is a copy of the words sliding with it: it says the same thing, and says it to
  // nobody — no reader hears the words twice, no tab stops in it, no find or selection lands in it.
  it("lights a copy of the same words that is hidden from readers and from input", () => {
    const html = renderToStaticMarkup(<RunShimmer sweeps>{words}</RunShimmer>);
    const document = markupDom(html);
    const duplicate = document.querySelector("[data-sweep-copy]");
    expect(duplicate?.textContent).toBe("Reading server.ts");
    expect(duplicate?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(duplicate?.closest("[inert]")).not.toBeNull();
    const realWords = document.querySelector("[data-sweep-words]");
    expect(realWords?.textContent).toBe("Reading server.ts");
    expect(realWords?.closest('[aria-hidden="true"], [inert]')).toBeNull();
  });
});
