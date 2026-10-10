import { describe, expect, it } from "vite-plus/test";

import {
  PAGE_POLICY,
  WRAPPER_POLICY,
  innerDocumentOf,
  linkToOpen,
  pageDocument,
  pageCapHeight,
  pageFrameHeight,
  readPageMessage,
  type PageTheme,
} from "./publishedPage.ts";

/** The page as it runs, inside the wrapper. */
const pageOf = (html: string, of: PageTheme = theme) => innerDocumentOf(pageDocument(html, of))!;

const theme = { scheme: "dark" as const, vars: { "--background": "#111", "--foreground": "#eee" } };

/** A token-shaped fixture built from parts: a literal one reads as a leaked secret to scanners. */
const fakeToken = (fill: string) => [8, 4, 4, 4, 12].map((n) => fill.repeat(n)).join("-");

describe("a published page's document", () => {
  it.each([
    {
      title: "a whole document with its own head",
      html: "<!doctype html><html lang=en><head><script>fetch('/api')</script></head><body><p>x</p></body></html>",
    },
    { title: "a fragment with no head", html: "<script>fetch('/api')</script><p>x</p>" },
    {
      title: "a page with its own looser policy",
      html: `<meta http-equiv="Content-Security-Policy" content="default-src *"><script>fetch('/api')</script><p>x</p>`,
    },
  ])("puts the policy that allows no network ahead of everything in $title", ({ html }) => {
    const doc = pageOf(html);
    const policy = doc.indexOf(
      `<meta http-equiv="Content-Security-Policy" content="${PAGE_POLICY}">`,
    );
    expect(policy).toBeGreaterThan(-1);
    expect(policy).toBeLessThan(doc.indexOf("<script>fetch"));
    expect(policy).toBeLessThan(doc.indexOf("<p>x</p>"));
    // The page itself follows whole: nothing of it is rewritten.
    expect(doc.endsWith(html)).toBe(true);
  });

  it("holds the page in a wrapper that lets no frame of it load anything but its own document", () => {
    const wrapper = pageDocument("<p>x</p>", theme);
    expect(wrapper.indexOf(`content="${WRAPPER_POLICY}"`)).toBeGreaterThan(-1);
    expect(wrapper.indexOf(`content="${WRAPPER_POLICY}"`)).toBeLessThan(wrapper.indexOf("<iframe"));
    expect(WRAPPER_POLICY).toContain("frame-src 'none'");
    expect(WRAPPER_POLICY).toContain("default-src 'none'");
    expect(wrapper).toContain('<iframe id="page" sandbox="allow-scripts"');
    expect(wrapper).not.toContain("allow-same-origin");
  });

  it("allows no network at all: inline scripts, styles and data pictures only", () => {
    const directives = new Map(
      PAGE_POLICY.split(";").map((part) => {
        const [name, ...values] = part.trim().split(/\s+/);
        return [name!, values.join(" ")] as const;
      }),
    );
    expect(directives.get("default-src")).toBe("'none'");
    expect(directives.get("script-src")).toBe("'unsafe-inline'");
    expect(directives.get("style-src")).toBe("'unsafe-inline'");
    expect(directives.get("img-src")).toBe("data: blob:");
    expect(directives.get("font-src")).toBe("data:");
    expect(directives.get("form-action")).toBe("'none'");
    expect(directives.get("base-uri")).toBe("'none'");
    expect(PAGE_POLICY).not.toMatch(/'self'|https?:|\*/);
  });

  it("carries the conversation's colours as the page's own variables, in its scheme", () => {
    const doc = pageOf("<p>x</p>");
    expect(doc).toContain("--background:#111;");
    expect(doc).toContain("--foreground:#eee;");
    expect(doc).toContain("color-scheme:dark;");
  });

  it("never lets a theme value close its style", () => {
    const doc = pageOf("<p>x</p>", {
      scheme: "light",
      vars: { "--background": "red;}</style><script>alert(1)</script>" },
    });
    expect(doc).not.toContain("<script>alert(1)");
  });
});

describe("what a published page says to the conversation", () => {
  it.each([
    {
      title: "its height",
      data: { mate: "page", kind: "height", height: 812.4 },
      want: { kind: "height", height: 813 },
    },
    {
      title: "a link to open",
      data: { mate: "page", kind: "open", url: "https://zerops.io/docs" },
      want: { kind: "open", url: "https://zerops.io/docs" },
    },
    {
      title: "a link to a script",
      data: { mate: "page", kind: "open", url: "javascript:alert(1)" },
      want: null,
    },
    {
      title: "a link to a file",
      data: { mate: "page", kind: "open", url: "file:///etc/passwd" },
      want: null,
    },
    {
      title: "a height that is no number",
      data: { mate: "page", kind: "height", height: "9999" },
      want: null,
    },
    { title: "its leaving", data: { mate: "page", kind: "left" }, want: { kind: "left" } },
    { title: "someone else's message", data: { kind: "height", height: 10 }, want: null },
  ])("reads $title", ({ data, want }) => {
    expect(readPageMessage(JSON.stringify(data), "null")).toEqual(want);
  });

  it.each([
    {
      title: "an object rather than the wrapper's string",
      data: { mate: "page", kind: "left" },
      origin: "null",
    },
    {
      title: "a message from an origin of its own",
      data: JSON.stringify({ mate: "page", kind: "left" }),
      origin: "https://example.com",
    },
    { title: "words that are no JSON", data: "left", origin: "null" },
  ])("ignores $title", ({ data, origin }) => {
    expect(readPageMessage(data, origin)).toBeNull();
  });

  it.each([
    {
      title: "a real click in the frame",
      fromFrame: true,
      focused: true,
      activated: true,
      opens: true,
    },
    {
      title: "a script's own message",
      fromFrame: true,
      focused: true,
      activated: false,
      opens: false,
    },
    {
      title: "another window's message",
      fromFrame: false,
      focused: true,
      activated: true,
      opens: false,
    },
    {
      title: "a message while the frame is not where the person clicked",
      fromFrame: true,
      focused: false,
      activated: true,
      opens: false,
    },
  ])(
    "opens a link in a new tab only on a real click: $title",
    ({ fromFrame, focused, activated, opens }) => {
      const message = { kind: "open" as const, url: "https://zerops.io/" };
      expect(linkToOpen(message, { fromFrame, focused, activated })).toBe(
        opens ? message.url : null,
      );
    },
  );
});

describe("a published page in a phone's web view", () => {
  const native = { kind: "native" as const, token: fakeToken("a") };
  /** What the wrapper runs, after the page's frame: the part the page can never reach. */
  const wrapperOf = (document: string) => document.slice(document.indexOf("</iframe>"));

  it("runs the same page, under the same policies, as the web's frame", () => {
    const html = "<script>fetch('/api')</script><p>x</p>";
    expect(innerDocumentOf(pageDocument(html, theme, native))).toBe(
      innerDocumentOf(pageDocument(html, theme)),
    );
    expect(pageDocument(html, theme, native)).toContain(`content="${WRAPPER_POLICY}"`);
  });

  it("talks to the app through its bridge, never to a parent window", () => {
    const wrapper = wrapperOf(pageDocument("<p>x</p>", theme, native));
    expect(wrapper).toContain("window.ReactNativeWebView");
    expect(wrapper).not.toContain("window.parent");
  });

  it.each([
    { title: "the token its wrapper was written with", token: native.token, reads: true },
    { title: "another token", token: fakeToken("b"), reads: false },
    {
      title: "no token, as a page posting to the bridge itself would",
      token: undefined,
      reads: false,
    },
  ])("reads a message only when it carries $title", ({ token, reads }) => {
    const data = JSON.stringify({ mate: "page", kind: "height", height: 120, token });
    expect(readPageMessage(data, "null", native.token)).toEqual(
      reads ? { kind: "height", height: 120 } : null,
    );
  });

  it("writes no token a page could close its script with", () => {
    expect(() => pageDocument("<p>x</p>", theme, { kind: "native", token: "</script>" })).toThrow();
  });
});

describe("a published page's frame height", () => {
  it.each([
    { title: "unknown, it stands at the shared cap", content: null, want: null },
    { title: "once the page says it, its own", content: 212, want: 212 },
    {
      title: "a tall page, its own height: the cap holds the frame and it scrolls inside",
      content: 2400,
      want: 2400,
    },
    { title: "an empty page, still a line tall", content: 0, want: 48 },
  ])("is $title", ({ content, want }) => {
    expect(pageFrameHeight(content)).toBe(want);
  });
});

describe("the cap a published page stands at before it says its height", () => {
  it.each([
    { title: "a tall view, the web's 440", view: 1000, want: 440 },
    { title: "a short view, about half of it", view: 600, want: 312 },
  ])("is $title", ({ view, want }) => {
    expect(pageCapHeight(view)).toBe(want);
  });
});
