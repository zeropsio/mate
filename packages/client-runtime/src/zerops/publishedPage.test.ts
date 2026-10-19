import { describe, expect, it } from "vite-plus/test";

import {
  PAGE_POLICY,
  WRAPPER_POLICY,
  innerDocumentOf,
  linkToOpen,
  pageDocument,
  PAGE_FIRST_HEIGHT,
  PAGE_FIT_START,
  PAGE_PROBE,
  knownPageHeights,
  pageFitHeard,
  pageFitStand,
  pageFrameHeight,
  pageHeightToRecord,
  pageScreenHeight,
  pageStandHeight,
  type PageFit,
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

  // The page's frame is the wrapper's srcdoc, so both policies hold for it: a picture shows only
  // where the wrapper allows it too (the owner, 2026-10-13: "why are these not loading?").
  it.each(["img-src", "font-src", "media-src"])(
    "lets through what the page carries inline, in the wrapper as in the page: %s",
    (directive) => {
      const of = (policy: string) =>
        new Map(
          policy.split(";").map((part) => {
            const [name, ...values] = part.trim().split(/\s+/);
            return [name!, values.join(" ")] as const;
          }),
        ).get(directive);
      expect(of(WRAPPER_POLICY)).toBe(of(PAGE_POLICY));
      expect(WRAPPER_POLICY).not.toMatch(/'self'|https?:|\*/);
    },
  );

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
      data: { mate: "page", kind: "height", height: 812.4, viewport: 600 },
      want: { kind: "height", height: 813, viewport: 600 },
    },
    {
      title: "its height, from a page that says no viewport",
      data: { mate: "page", kind: "height", height: 812.4 },
      want: { kind: "height", height: 813, viewport: null },
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
    const data = JSON.stringify({ mate: "page", kind: "height", height: 120, viewport: 80, token });
    expect(readPageMessage(data, "null", native.token)).toEqual(
      reads ? { kind: "height", height: 120, viewport: 80 } : null,
    );
  });

  it("writes no token a page could close its script with", () => {
    expect(() => pageDocument("<p>x</p>", theme, { kind: "native", token: "</script>" })).toThrow();
  });
});

describe("a published page's frame height", () => {
  it.each([
    { title: "once the page says it, its own", content: 212, want: 212 },
    { title: "a page of any height, its own: nothing caps it", content: 12_000, want: 12_000 },
    { title: "an empty page, still a line tall", content: 0, want: 48 },
  ])("is $title", ({ content, want }) => {
    expect(pageFrameHeight(content)).toBe(want);
  });
});

describe("where a published page stands before it says its height", () => {
  const heights = [
    [375, 1400],
    [728, 900],
  ] as const;
  it.each([
    { title: "measured at this width: that height", width: 728, want: 900 },
    { title: "measured at a near width: the nearest one's", width: 700, want: 900 },
    { title: "measured at a phone's width: the phone's", width: 390, want: 1400 },
  ])("a page measured once paints at its height on every later view: $title", ({ width, want }) => {
    expect(pageStandHeight({ content: null, heights, width })).toBe(want);
  });

  it("on its very first landing, a modest box it glides from", () => {
    expect(pageStandHeight({ content: null, heights: [], width: 728 })).toBe(PAGE_FIRST_HEIGHT);
  });

  it("once the page says its height, that height", () => {
    expect(pageStandHeight({ content: 640, heights, width: 728 })).toBe(640);
  });
});

describe("the height a client records for a page", () => {
  it("is its frame's width and the page's height, once per width", () => {
    const first = pageHeightToRecord({
      itemId: "c/r/1/i/2",
      heights: [],
      width: 727.6,
      content: 9000,
    });
    expect(first).toEqual([728, 9000]);
    // Known now, in memory: a frame mounted again paints at it, and records nothing again.
    const known = knownPageHeights("c/r/1/i/2", undefined);
    expect(known).toEqual([[728, 9000]]);
    expect(
      pageHeightToRecord({ itemId: "c/r/1/i/2", heights: known, width: 728, content: 9000 }),
    ).toBeNull();
  });

  it("is nothing at a width no frame stands at", () => {
    expect(
      pageHeightToRecord({ itemId: "c/r/1/i/3", heights: [], width: 40, content: 300 }),
    ).toBeNull();
  });
});

/**
 * A frame holding a page laid out by `layout` (its height at a viewport), as the conversation's
 * frame runs it: the page says its height at its viewport, the frame hears it and stands again,
 * until the page says nothing new.
 */
const fitted = (input: {
  readonly layout: (viewport: number) => number;
  readonly heights?: ReadonlyArray<readonly [number, number]>;
  readonly screen?: number;
}) => {
  const heights = input.heights ?? [];
  const screen = input.screen ?? 720;
  let fit: PageFit = PAGE_FIT_START;
  const stand = () => pageFitStand({ fit, heights, width: 728, screen });
  const stood = [stand()];
  for (let said = 0; said < 50; said++) {
    const viewport = stand() + (fit.asking === null ? 0 : PAGE_PROBE);
    const next = pageFitHeard(fit, { height: input.layout(viewport), viewport }, stand());
    if (next === fit) break;
    fit = next;
    if (stand() !== stood.at(-1)) stood.push(stand());
  }
  return { fit, stood };
};

describe("how a published page is fitted to its frame", () => {
  it.each([
    { title: "a page taller than its frame, however tall", layout: () => 12_000, want: 12_000 },
    { title: "a page shorter than its frame", layout: () => 150, want: 150 },
    {
      title: "a page that fills at least its viewport (min-height: 100vh), its content",
      layout: (viewport: number) => Math.max(1500, viewport),
      want: 1500,
    },
    {
      title: "a page a fraction of it sizes (30vh), where that settles",
      layout: (viewport: number) => Math.round(viewport * 0.3) + 700,
      want: 1000,
    },
  ])("stands at its own height: $title", ({ layout, want }) => {
    expect(fitted({ layout }).stood.at(-1)).toBe(want);
  });

  it.each([
    { title: "slides each a viewport tall (100vh)", layout: (viewport: number) => viewport * 6 },
    {
      title: "a viewport-tall opening over its content",
      layout: (viewport: number) => viewport + 900,
    },
  ])(
    "a page its viewport sizes never grows without end: it stands a screen tall, $title",
    ({ layout }) => {
      const { fit, stood } = fitted({ layout, screen: 720 });
      expect(fit.sizedBy).toBe("viewport");
      expect(stood).toEqual([PAGE_FIRST_HEIGHT, 720]);
    },
  );

  it("asks a page taller than its frame first, without moving: the asking stays hidden past the frame", () => {
    const asked = pageFitHeard(PAGE_FIT_START, { height: 900, viewport: 240 }, 240);
    expect(asked.asking).toBe(900);
    expect(pageFitStand({ fit: asked, heights: [], width: 728, screen: 720 })).toBe(
      PAGE_FIRST_HEIGHT,
    );
    // A height said before the view reached past the frame answers nothing yet.
    expect(pageFitHeard(asked, { height: 910, viewport: 240 }, 240)).toBe(asked);
  });

  it("a page its content sizes follows its content straight after, up and down", () => {
    let fit = fitted({ layout: () => 900 }).fit;
    expect(fit.sizedBy).toBe("content");
    fit = pageFitHeard(fit, { height: 1400, viewport: 900 }, 900);
    expect(fit).toEqual({ content: 1400, sizedBy: "content", asking: null });
    fit = pageFitHeard(fit, { height: 600, viewport: 1400 }, 1400);
    expect(fit.content).toBe(600);
  });

  it("a page measured once stands at its height on a later view without asking", () => {
    const { stood } = fitted({ layout: () => 900, heights: [[728, 900]] });
    expect(stood).toEqual([900]);
  });

  it("a page its viewport sizes, measured once a screen tall, stands there on a later view", () => {
    const { stood } = fitted({ layout: (viewport) => viewport * 6, heights: [[728, 720]] });
    expect(stood).toEqual([720]);
  });

  it.each([
    { visible: 900, want: 720 },
    { visible: 200, want: PAGE_FIRST_HEIGHT },
  ])(
    "a screen is four fifths of the conversation's view, never less than a first box: $visible",
    ({ visible, want }) => {
      expect(pageScreenHeight(visible)).toBe(want);
    },
  );
});
