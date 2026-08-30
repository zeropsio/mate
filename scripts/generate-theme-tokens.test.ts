// @effect-diagnostics nodeBuiltinImport:off -- Byte-equality checks read the projected workspace files.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  BUILT_IN_THEMES,
  ZEROPS_THEME,
  type ThemeAppearance,
  type ThemeColors,
} from "@t3tools/shared/themePalettes";
import {
  createMobileThemeVariables,
  MOBILE_THEME_VARIABLE_NAMES,
  themeColorToNativeColor,
  type MobileThemeVariables,
} from "@t3tools/shared/mobileThemeVariables";

import {
  getThemeTokenProjectionOutputs,
  MOBILE_THEME_TOKEN_MARKERS,
  replaceGeneratedRegion,
  runThemeTokenProjector,
  WEB_THEME_TOKEN_MARKERS,
  type ThemeTokenProjectionOutput,
} from "./generate-theme-tokens.ts";

type BootPalette = Readonly<{
  background: string;
  foreground: string;
  accent: string;
  chrome: string;
}>;
type SplashPalette = Readonly<Omit<BootPalette, "chrome">>;
type AppearanceRecord<T> = Readonly<Record<ThemeAppearance, T>>;

const temporaryRoots: Array<string> = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

function colorsFor(appearance: ThemeAppearance): ThemeColors {
  return appearance === "light" ? ZEROPS_THEME.colors : ZEROPS_THEME.variants!.dark!;
}

function extractInlineScript(html: string): string {
  const match = /<script>([\s\S]*?)<\/script>/u.exec(html);
  if (!match?.[1]) throw new Error("Could not find the inline boot script.");
  return match[1];
}

function extractObjectLiteral(source: string, constantName: string): unknown {
  const marker = `const ${constantName} = `;
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) throw new Error(`Could not find ${constantName}.`);
  const openingBraceIndex = source.indexOf("{", markerIndex + marker.length);
  let depth = 0;
  for (let index = openingBraceIndex; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) {
      const literal = source.slice(openingBraceIndex, index + 1);
      return new Function(`return (${literal})`)() as unknown;
    }
  }
  throw new Error(`Could not find the end of ${constantName}.`);
}

function readVariantVariables(css: string, appearance: ThemeAppearance): MobileThemeVariables {
  const marker = `@variant ${appearance} {`;
  const markerIndex = css.indexOf(marker);
  if (markerIndex === -1) throw new Error(`Could not find ${marker}.`);
  const openingBraceIndex = css.indexOf("{", markerIndex);
  let depth = 0;
  for (let index = openingBraceIndex; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] !== "}") continue;
    depth -= 1;
    if (depth !== 0) continue;
    const body = css.slice(openingBraceIndex + 1, index);
    return Object.fromEntries(
      MOBILE_THEME_VARIABLE_NAMES.map((name) => {
        const match = new RegExp(`^\\s*${name}:\\s*([^;]+);`, "mu").exec(body);
        if (!match?.[1]) throw new Error(`${appearance} is missing ${name}.`);
        return [name, match[1].trim()];
      }),
    ) as MobileThemeVariables;
  }
  throw new Error(`Could not find the end of ${marker}.`);
}

function diffExcerpt(actual: string, expected: string): string {
  let index = 0;
  while (index < actual.length && actual[index] === expected[index]) index += 1;
  return `first difference at byte ${index}: actual ${JSON.stringify(actual.slice(index, index + 80))}, expected ${JSON.stringify(expected.slice(index, index + 80))}`;
}

function expectCurrentBytes(output: ThemeTokenProjectionOutput): void {
  const actual = NodeFS.readFileSync(output.path, "utf8");
  expect(actual, `${output.target}: ${diffExcerpt(actual, output.contents)}`).toBe(output.contents);
}

function createTemporaryProjectionRoot(): Readonly<{
  pristine: ReadonlyArray<ThemeTokenProjectionOutput>;
  root: string;
}> {
  const pristine = getThemeTokenProjectionOutputs();
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "z3-theme-token-projection-"));
  temporaryRoots.push(root);
  for (const output of pristine) {
    const outputPath = NodePath.join(root, output.target);
    NodeFS.mkdirSync(NodePath.dirname(outputPath), { recursive: true });
    NodeFS.writeFileSync(outputPath, output.contents);
  }
  return { pristine, root };
}

function readTemporaryTarget(root: string, target: ThemeTokenProjectionOutput["target"]): string {
  return NodeFS.readFileSync(NodePath.join(root, target), "utf8");
}

function writeTemporaryTarget(
  root: string,
  target: ThemeTokenProjectionOutput["target"],
  contents: string,
): void {
  NodeFS.writeFileSync(NodePath.join(root, target), contents);
}

function driftByteAtAnchor(contents: string, anchor: string): string {
  const index = contents.indexOf(anchor);
  if (index === -1) throw new Error(`Could not find drift anchor ${anchor}.`);
  const current = contents[index]!;
  const replacement = current === "x" ? "y" : "x";
  return `${contents.slice(0, index)}${replacement}${contents.slice(index + 1)}`;
}

function targetHashes(
  root: string,
  outputs: ReadonlyArray<ThemeTokenProjectionOutput>,
): ReadonlyArray<Readonly<{ hash: string; target: ThemeTokenProjectionOutput["target"] }>> {
  return outputs.map((output) => ({
    target: output.target,
    hash: NodeCrypto.createHash("sha256")
      .update(NodeFS.readFileSync(NodePath.join(root, output.target)))
      .digest("hex"),
  }));
}

function projectedHashes(
  outputs: ReadonlyArray<ThemeTokenProjectionOutput>,
): ReadonlyArray<Readonly<{ hash: string; target: ThemeTokenProjectionOutput["target"] }>> {
  return outputs.map((output) => ({
    target: output.target,
    hash: NodeCrypto.createHash("sha256").update(output.contents).digest("hex"),
  }));
}

describe("generate theme tokens", () => {
  it("keeps every committed projection byte-equal to the projector output", () => {
    for (const output of getThemeTokenProjectionOutputs()) expectCurrentBytes(output);
  });

  it("projects every web boot value from its source role", () => {
    const web = getThemeTokenProjectionOutputs().find(
      (output) => output.target === "apps/web/index.html",
    )!;
    const script = extractInlineScript(web.contents);
    const defaults = extractObjectLiteral(
      script,
      "DEFAULT_THEME_PALETTES",
    ) as AppearanceRecord<BootPalette>;
    const splash = extractObjectLiteral(script, "SPLASH_COLORS") as AppearanceRecord<SplashPalette>;
    const builtIns = extractObjectLiteral(script, "BUILT_IN_THEME_PALETTES") as Readonly<
      Record<string, AppearanceRecord<BootPalette>>
    >;

    for (const appearance of ["light", "dark"] as const) {
      const colors = colorsFor(appearance);
      expect(defaults[appearance]).toEqual({
        background: colors.canvas,
        foreground: colors.text,
        accent: colors.accent,
        chrome: colors.chrome,
      });
      expect(splash[appearance]).toEqual({
        background: themeColorToNativeColor(colors.canvas),
        foreground: themeColorToNativeColor(colors.text),
        accent: themeColorToNativeColor(colors.accent),
      });
    }

    for (const theme of BUILT_IN_THEMES) {
      for (const appearance of ["light", "dark"] as const) {
        const colors =
          appearance === theme.appearance
            ? theme.colors
            : (theme.variants?.[appearance] ?? theme.colors);
        expect(builtIns[theme.id]?.[appearance]).toEqual({
          background: colors.canvas,
          foreground: colors.text,
          accent: colors.accent,
          chrome: colors.chrome,
        });
      }
    }

    expect(web.contents.match(/<meta name="theme-color" content="([^"]+)"/u)?.[1]).toBe(
      themeColorToNativeColor(ZEROPS_THEME.variants!.dark!.chrome),
    );
  });

  it("uses a JavaScript line-comment end marker inside the web boot script", () => {
    const web = getThemeTokenProjectionOutputs().find(
      (output) => output.target === "apps/web/index.html",
    )!;

    expect(WEB_THEME_TOKEN_MARKERS.end).toMatch(/^\/\//u);
    expect(extractInlineScript(web.contents)).toMatch(/^\s*\/\/ generated:theme-tokens end\s*$/mu);
  });

  it("projects all 65 mobile values from the Zerops roles", () => {
    const mobile = getThemeTokenProjectionOutputs().find(
      (output) => output.target === "apps/mobile/global.css",
    )!;
    for (const appearance of ["light", "dark"] as const) {
      const actual = readVariantVariables(mobile.contents, appearance);
      expect(Object.keys(actual)).toEqual(MOBILE_THEME_VARIABLE_NAMES);
      expect(actual).toEqual(createMobileThemeVariables(colorsFor(appearance), appearance));
    }
  });

  it.each([
    ["web start", WEB_THEME_TOKEN_MARKERS, "start"],
    ["web end", WEB_THEME_TOKEN_MARKERS, "end"],
    ["mobile start", MOBILE_THEME_TOKEN_MARKERS, "start"],
    ["mobile end", MOBILE_THEME_TOKEN_MARKERS, "end"],
  ] as const)("fails safely when the %s marker is absent", (_name, markers, missing) => {
    const marker = markers[missing];
    const otherMarker = markers[missing === "start" ? "end" : "start"];
    expect(() =>
      replaceGeneratedRegion(
        `before\n${otherMarker}\nafter\n`,
        "generated",
        "fixture.txt",
        markers,
      ),
    ).toThrow(`fixture.txt is missing marker ${marker}`);
  });

  it.each([
    [
      "the start marker is duplicated",
      `prefix\n${WEB_THEME_TOKEN_MARKERS.start}\n${WEB_THEME_TOKEN_MARKERS.start}\nold\n${WEB_THEME_TOKEN_MARKERS.end}\nsuffix\n`,
      `fixture.html contains marker ${WEB_THEME_TOKEN_MARKERS.start} more than once (start count 2, end count 1)`,
    ],
    [
      "an end marker appears before the generated region",
      `${WEB_THEME_TOKEN_MARKERS.end}\nprefix\n${WEB_THEME_TOKEN_MARKERS.start}\nold\n${WEB_THEME_TOKEN_MARKERS.end}\nsuffix\n`,
      `fixture.html contains marker ${WEB_THEME_TOKEN_MARKERS.end} more than once (start count 1, end count 2)`,
    ],
    [
      "the markers are reversed",
      `prefix\n${WEB_THEME_TOKEN_MARKERS.end}\nold\n${WEB_THEME_TOKEN_MARKERS.start}\nsuffix\n`,
      "fixture.html has reversed generated markers (start count 1, end count 1)",
    ],
  ])("fails loudly when %s", (_name, fixture, expectedError) => {
    expect(() =>
      replaceGeneratedRegion(fixture, "generated", "fixture.html", WEB_THEME_TOKEN_MARKERS),
    ).toThrow(expectedError);
  });

  it("runs check mode against both drifted targets without writing either file", () => {
    const { pristine, root } = createTemporaryProjectionRoot();
    const web = pristine.find((output) => output.target === "apps/web/index.html")!;
    const mobile = pristine.find((output) => output.target === "apps/mobile/global.css")!;
    writeTemporaryTarget(root, web.target, driftByteAtAnchor(web.contents, "LIGHT_BACKGROUND"));
    writeTemporaryTarget(root, mobile.target, driftByteAtAnchor(mobile.contents, "--color-screen"));
    const before = targetHashes(root, pristine);

    const result = runThemeTokenProjector({ root, check: true });

    expect(result.exitCode).toBe(1);
    expect(result.staleTargets).toEqual([web.target, mobile.target]);
    expect(targetHashes(root, pristine)).toEqual(before);
  });

  it("runs the writer to restore both targets exactly and remains idempotent", () => {
    const { pristine, root } = createTemporaryProjectionRoot();
    const web = pristine.find((output) => output.target === "apps/web/index.html")!;
    const mobile = pristine.find((output) => output.target === "apps/mobile/global.css")!;
    writeTemporaryTarget(root, web.target, driftByteAtAnchor(web.contents, "LIGHT_BACKGROUND"));
    writeTemporaryTarget(root, mobile.target, driftByteAtAnchor(mobile.contents, "--color-screen"));

    expect(runThemeTokenProjector({ root, check: false }).exitCode).toBe(0);
    const restored = targetHashes(root, pristine);
    expect(restored).toEqual(projectedHashes(pristine));

    expect(runThemeTokenProjector({ root, check: false }).exitCode).toBe(0);
    expect(targetHashes(root, pristine)).toEqual(restored);
  });

  it("runs the writer while preserving a byte outside the web markers", () => {
    const { pristine, root } = createTemporaryProjectionRoot();
    const web = pristine.find((output) => output.target === "apps/web/index.html")!;
    const outsideMutation = web.contents.replace("<!doctype html>", "<!doctypf html>");
    writeTemporaryTarget(root, web.target, driftByteAtAnchor(outsideMutation, "LIGHT_BACKGROUND"));

    expect(runThemeTokenProjector({ root, check: false }).exitCode).toBe(0);
    expect(readTemporaryTarget(root, web.target)).toBe(outsideMutation);
  });

  it("does not write the web target when mobile marker validation fails", () => {
    const { pristine, root } = createTemporaryProjectionRoot();
    const web = pristine.find((output) => output.target === "apps/web/index.html")!;
    const mobile = pristine.find((output) => output.target === "apps/mobile/global.css")!;
    writeTemporaryTarget(root, web.target, driftByteAtAnchor(web.contents, "LIGHT_BACKGROUND"));
    writeTemporaryTarget(
      root,
      mobile.target,
      mobile.contents.replace(MOBILE_THEME_TOKEN_MARKERS.end, ""),
    );
    const webHashBefore = targetHashes(root, [web]);

    expect(() => runThemeTokenProjector({ root, check: false })).toThrow(
      `apps/mobile/global.css is missing marker ${MOBILE_THEME_TOKEN_MARKERS.end} (start count 1, end count 0)`,
    );
    expect(targetHashes(root, [web])).toEqual(webHashBefore);
  });

  it("preserves every byte outside a generated region", () => {
    const fixture = `prefix\n${WEB_THEME_TOKEN_MARKERS.start}\nold\n${WEB_THEME_TOKEN_MARKERS.end}\nsuffix\n`;
    expect(
      replaceGeneratedRegion(fixture, "new\ncontent", "fixture.html", WEB_THEME_TOKEN_MARKERS),
    ).toBe(
      `prefix\n${WEB_THEME_TOKEN_MARKERS.start}\nnew\ncontent\n${WEB_THEME_TOKEN_MARKERS.end}\nsuffix\n`,
    );
  });
});
