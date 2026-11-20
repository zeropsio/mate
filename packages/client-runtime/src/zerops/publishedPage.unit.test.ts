import { expect, it } from "vite-plus/test";

import { innerDocumentOf, pageDocument, themeMessage, type PageTheme } from "./publishedPage.ts";

const theme: PageTheme = {
  scheme: "dark",
  vars: { "--background": "#000", "--foreground": "#fff" },
};

/** A document's own Content-Security-Policy, directive by directive. */
function policyOf(document: string): ReadonlyMap<string, ReadonlyArray<string>> {
  const content = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(
    document,
  )?.[1];
  return new Map(
    (content ?? "").split(";").map((directive) => {
      const [name = "", ...sources] = directive.trim().split(/\s+/u);
      return [name, sources] as const;
    }),
  );
}

/** Sources that reach nothing outside the document: inline code and pictures carried in it. */
const LOCAL_SOURCES = new Set(["'none'", "'unsafe-inline'", "data:", "blob:"]);

// witness: packages/client-runtime/src/zerops/publishedPage.ts | "frame-src 'none'", → "frame-src 'self' https:",
it("ZV126: A published page's wrapper loads only its own document and allows no network: inline scripts, styles and data pictures only", () => {
  const wrapper = pageDocument("<p>hello</p>", theme);
  const page = innerDocumentOf(wrapper);
  expect(page).not.toBeNull();
  const wrapperPolicy = policyOf(wrapper);
  const pagePolicy = policyOf(page!);
  expect(wrapperPolicy.get("default-src")).toEqual(["'none'"]);
  expect(wrapperPolicy.get("frame-src")).toEqual(["'none'"]);
  expect(pagePolicy.get("default-src")).toEqual(["'none'"]);
  for (const policy of [wrapperPolicy, pagePolicy])
    for (const sources of policy.values())
      for (const source of sources) expect(LOCAL_SOURCES.has(source), source).toBe(true);
});

const count = (text: string, part: string) => text.split(part).length - 1;

// witness: packages/client-runtime/src/zerops/publishedPage.ts | const SAFE_VALUE = /^[^<>{};\\]*$/; → const SAFE_VALUE = /^[^{};\\]*$/;
it("ZV127: No theme value or bridge token can close the published page's style or script element", () => {
  const hostile: PageTheme = {
    scheme: "light",
    vars: { "--background": "red</style><script>parent.x()</script>", "--foreground": "#111" },
  };
  const page = innerDocumentOf(pageDocument("", hostile))!;
  const clean = innerDocumentOf(pageDocument("", theme))!;
  expect(count(page, "</style>")).toBe(count(clean, "</style>"));
  expect(count(page, "</script>")).toBe(count(clean, "</script>"));
  expect(themeMessage(hostile)).not.toContain("<");
  expect(() =>
    pageDocument("", theme, {
      host: { kind: "native", token: 'abcdefghijklmnop"</script><script>x()' },
    }),
  ).toThrow();
});
