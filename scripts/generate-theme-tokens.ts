#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off -- This host projector rewrites marked workspace files.

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  createMobileThemeVariables,
  themeColorToNativeColor,
  type MobileThemeVariables,
} from "@t3tools/shared/mobileThemeVariables";
import {
  BUILT_IN_THEMES,
  THEME_COLOR_ROLES,
  ZEROPS_THEME,
  type ThemeAppearance,
  type ThemeColors,
  type ThemeDefinition,
} from "@t3tools/shared/themePalettes";
import { ZEROPS_MARK } from "@t3tools/shared/brand";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { Command, Flag } from "effect/unstable/cli";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const APPEARANCES = ["light", "dark"] as const;
const DEFAULT_REPOSITORY_ROOT = NodePath.resolve(import.meta.dirname, "..");

export const WEB_THEME_TOKEN_MARKERS = {
  start: "<!-- generated:theme-tokens start -->",
  end: "// generated:theme-tokens end",
} as const;

export const WEB_BOOT_MARK_MARKERS = {
  start: "<!-- generated:boot-mark start -->",
  end: "<!-- generated:boot-mark end -->",
} as const;

export const MOBILE_THEME_TOKEN_MARKERS = {
  start: "/* generated:theme-tokens start */",
  end: "/* generated:theme-tokens end */",
} as const;

export interface GeneratedRegionMarkers {
  readonly start: string;
  readonly end: string;
}

export interface ThemeTokenProjectionOutput {
  readonly target: "apps/web/index.html" | "apps/web/public/favicon.svg" | "apps/mobile/global.css";
  readonly path: string;
  readonly contents: string;
}

export interface ThemeTokenProjectionCheckResult {
  readonly staleTargets: ReadonlyArray<ThemeTokenProjectionOutput["target"]>;
  readonly messages: ReadonlyArray<string>;
  readonly exitCode: 0 | 1;
}

export interface RunThemeTokenProjectorOptions {
  readonly check: boolean;
  readonly root?: string;
}

interface GeneratedRegionLocation {
  readonly bodyStart: number;
  readonly bodyEnd: number;
}

type BootPalette = Readonly<{
  background: string;
  foreground: string;
  accent: string;
  chrome: string;
}>;

const countOccurrences = (source: string, marker: string): number => {
  let count = 0;
  let index = source.indexOf(marker);
  while (index !== -1) {
    count += 1;
    index = source.indexOf(marker, index + marker.length);
  }
  return count;
};

const locateGeneratedRegion = (
  source: string,
  target: string,
  markers: GeneratedRegionMarkers,
): GeneratedRegionLocation => {
  const startCount = countOccurrences(source, markers.start);
  const endCount = countOccurrences(source, markers.end);
  const counts = `start count ${startCount}, end count ${endCount}`;
  if (startCount === 0) {
    throw new Error(`${target} is missing marker ${markers.start} (${counts})`);
  }
  if (startCount !== 1) {
    throw new Error(`${target} contains marker ${markers.start} more than once (${counts})`);
  }
  if (endCount === 0) {
    throw new Error(`${target} is missing marker ${markers.end} (${counts})`);
  }
  if (endCount !== 1) {
    throw new Error(`${target} contains marker ${markers.end} more than once (${counts})`);
  }

  const startIndex = source.indexOf(markers.start);
  const endIndex = source.indexOf(markers.end);
  if (startIndex > endIndex) {
    throw new Error(`${target} has reversed generated markers (${counts})`);
  }

  const startLineEnd = source.indexOf("\n", startIndex + markers.start.length);
  if (startLineEnd === -1) throw new Error(`${target} has no content after ${markers.start}`);
  const endLineStart = source.lastIndexOf("\n", endIndex) + 1;
  if (endLineStart <= startLineEnd) {
    throw new Error(`${target} has an invalid generated region`);
  }
  return { bodyStart: startLineEnd + 1, bodyEnd: endLineStart };
};

export function replaceGeneratedRegion(
  source: string,
  generated: string,
  target: string,
  markers: GeneratedRegionMarkers,
): string {
  const location = locateGeneratedRegion(source, target, markers);
  return `${source.slice(0, location.bodyStart)}${generated.replace(/\n$/u, "")}\n${source.slice(location.bodyEnd)}`;
}

const colorsForTheme = (theme: ThemeDefinition, appearance: ThemeAppearance): ThemeColors => {
  const colors =
    appearance === theme.appearance ? theme.colors : (theme.variants?.[appearance] ?? theme.colors);
  for (const role of THEME_COLOR_ROLES) {
    if (typeof colors[role] !== "string") {
      throw new Error(`${theme.id}/${appearance} is missing theme role ${role}`);
    }
  }
  return colors;
};

const bootPalette = (colors: ThemeColors): BootPalette => ({
  background: colors.canvas,
  foreground: colors.text,
  accent: colors.accent,
  chrome: colors.chrome,
});

const renderBootPaletteProperties = (palette: BootPalette, indentation: string): string =>
  [
    `${indentation}background: ${JSON.stringify(palette.background)},`,
    `${indentation}foreground: ${JSON.stringify(palette.foreground)},`,
    `${indentation}accent: ${JSON.stringify(palette.accent)},`,
    `${indentation}chrome: ${JSON.stringify(palette.chrome)},`,
  ].join("\n");

const renderDefaultThemePalettes = (): string => {
  const lines = ["        const DEFAULT_THEME_PALETTES = {"];
  for (const appearance of APPEARANCES) {
    lines.push(`          ${appearance}: {`);
    lines.push(
      renderBootPaletteProperties(
        bootPalette(colorsForTheme(ZEROPS_THEME, appearance)),
        "            ",
      ),
    );
    lines.push("          },");
  }
  lines.push("        };");
  return lines.join("\n");
};

const renderSplashColors = (): string => {
  const lines = ["        const SPLASH_COLORS = {"];
  for (const appearance of APPEARANCES) {
    const colors = colorsForTheme(ZEROPS_THEME, appearance);
    lines.push(
      `          ${appearance}: {`,
      `            background: ${JSON.stringify(themeColorToNativeColor(colors.canvas))},`,
      `            foreground: ${JSON.stringify(themeColorToNativeColor(colors.text))},`,
      `            accent: ${JSON.stringify(themeColorToNativeColor(colors.accent))},`,
      "          },",
    );
  }
  lines.push("        };");
  return lines.join("\n");
};

const propertyName = (value: string): string =>
  /^[a-z_$][\w$]*$/iu.test(value) ? value : JSON.stringify(value);

const renderBuiltInThemePalettes = (): string => {
  const lines = ["        const BUILT_IN_THEME_PALETTES = {"];
  for (const theme of BUILT_IN_THEMES) {
    lines.push(`          ${propertyName(theme.id)}: {`);
    for (const appearance of APPEARANCES) {
      lines.push(`            ${appearance}: {`);
      lines.push(
        renderBootPaletteProperties(
          bootPalette(colorsForTheme(theme, appearance)),
          "              ",
        ),
      );
      lines.push("            },");
    }
    lines.push("          },");
  }
  lines.push("        };");
  return lines.join("\n");
};

const renderWebThemeTokens = (): string =>
  [
    `    <meta name="theme-color" content="${themeColorToNativeColor(ZEROPS_THEME.variants!.dark!.chrome)}" />`,
    '    <link rel="icon" type="image/svg+xml" href="%BASE_URL%favicon.svg" />',
    '    <link rel="manifest" href="%BASE_URL%manifest.webmanifest" />',
    "    <script>",
    "      (() => {",
    '        const LIGHT_BACKGROUND = "#ffffff";',
    '        const DARK_BACKGROUND = "#0a0a0a";',
    '        const CUSTOM_THEMES_STORAGE_KEY = "t3code:themes:v1";',
    '        const THEME_FOLLOW_SYSTEM_STORAGE_KEY = "t3code:theme-follow-system";',
    '        const THEME_APPEARANCE_MODE_STORAGE_KEY = "t3code:theme-appearance-mode";',
    '        const THEME_HALVES_STORAGE_KEY = "t3code:theme-halves:v1";',
    renderSplashColors(),
    "        // These are the runtime defaults used to complete a custom palette",
    "        // when a stored theme omits a role. Keep them separate from the",
    "        // unselected splash so a partial custom theme does not flash generic",
    "        // app colors before React mounts.",
    renderDefaultThemePalettes(),
    "        // This generated boot-time copy makes the selected theme visible before",
    "        // the app has mounted.",
    renderBuiltInThemePalettes(),
  ].join("\n");

const renderWebBootMark = (): string =>
  [
    `          <svg id="boot-shell-logo" viewBox="${ZEROPS_MARK.viewBox}" role="img" aria-label="Zerops Code">`,
    ...ZEROPS_MARK.paths.flatMap((path) => [
      "            <path",
      `              d="${path.d}"`,
      `              fill="${path.fill}"`,
      "            />",
    ]),
    "          </svg>",
  ].join("\n");

const renderZeropsFaviconSvg = (): string =>
  [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${ZEROPS_MARK.viewBox}">`,
    ...ZEROPS_MARK.paths.map((path) => `  <path d="${path.d}" fill="${path.fill}" />`),
    "</svg>",
    "",
  ].join("\n");

const projectWebThemeTokens = (source: string): string =>
  replaceGeneratedRegion(
    replaceGeneratedRegion(
      source,
      renderWebBootMark(),
      "apps/web/index.html",
      WEB_BOOT_MARK_MARKERS,
    ),
    renderWebThemeTokens(),
    "apps/web/index.html",
    WEB_THEME_TOKEN_MARKERS,
  );

const renderVariant = (name: ThemeAppearance, variables: MobileThemeVariables): string => {
  const declarations = Object.entries(variables)
    .map(([variable, value]) => `      ${variable}: ${value};`)
    .join("\n");
  return `    @variant ${name} {\n${declarations}\n    }`;
};

const projectMobileThemeTokens = (source: string): string =>
  replaceGeneratedRegion(
    source,
    APPEARANCES.map((appearance) =>
      renderVariant(
        appearance,
        createMobileThemeVariables(colorsForTheme(ZEROPS_THEME, appearance), appearance),
      ),
    ).join("\n\n"),
    "apps/mobile/global.css",
    MOBILE_THEME_TOKEN_MARKERS,
  );

export function getThemeTokenProjectionOutputs(
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
): ReadonlyArray<ThemeTokenProjectionOutput> {
  const webPath = NodePath.join(repositoryRoot, "apps/web/index.html");
  const webFaviconPath = NodePath.join(repositoryRoot, "apps/web/public/favicon.svg");
  const mobilePath = NodePath.join(repositoryRoot, "apps/mobile/global.css");
  return [
    {
      target: "apps/web/index.html",
      path: webPath,
      contents: projectWebThemeTokens(NodeFS.readFileSync(webPath, "utf8")),
    },
    {
      target: "apps/web/public/favicon.svg",
      path: webFaviconPath,
      contents: renderZeropsFaviconSvg(),
    },
    {
      target: "apps/mobile/global.css",
      path: mobilePath,
      contents: projectMobileThemeTokens(NodeFS.readFileSync(mobilePath, "utf8")),
    },
  ];
}

function checkThemeTokenProjectionOutputs(
  outputs: ReadonlyArray<ThemeTokenProjectionOutput>,
  readCurrent: (output: ThemeTokenProjectionOutput) => string | null,
): ThemeTokenProjectionCheckResult {
  const staleTargets = outputs
    .filter((output) => readCurrent(output) !== output.contents)
    .map((output) => output.target);
  return {
    staleTargets,
    messages: staleTargets.map(
      (target) =>
        `${target} is stale. Run node scripts/generate-theme-tokens.ts and commit the result.`,
    ),
    exitCode: staleTargets.length === 0 ? 0 : 1,
  };
}

export function runThemeTokenProjector({
  check,
  root = DEFAULT_REPOSITORY_ROOT,
}: RunThemeTokenProjectorOptions): ThemeTokenProjectionCheckResult {
  const outputs = getThemeTokenProjectionOutputs(root);
  if (check) {
    return checkThemeTokenProjectionOutputs(outputs, (output) =>
      NodeFS.existsSync(output.path) ? NodeFS.readFileSync(output.path, "utf8") : null,
    );
  }

  for (const output of outputs) {
    const current = NodeFS.existsSync(output.path)
      ? NodeFS.readFileSync(output.path, "utf8")
      : null;
    if (current !== output.contents) NodeFS.writeFileSync(output.path, output.contents);
  }
  return {
    staleTargets: [],
    messages: outputs.map((output) => `Generated ${output.target}.`),
    exitCode: 0,
  };
}

export const generateThemeTokensCommand = Command.make(
  "generate-theme-tokens",
  {
    check: Flag.boolean("check").pipe(
      Flag.withDescription("Check generated projections without writing them."),
    ),
  },
  ({ check }) =>
    Effect.gen(function* () {
      const result = yield* Effect.sync(() => runThemeTokenProjector({ check }));
      for (const message of result.messages) {
        if (result.exitCode === 0) yield* Console.log(message);
        else yield* Console.error(message);
      }
      if (check && result.exitCode === 0)
        yield* Console.log("Theme token projections are current.");
      if (result.exitCode !== 0) {
        yield* Effect.sync(() => {
          process.exitCode = result.exitCode;
        });
      }
    }),
).pipe(Command.withDescription("Project shared theme roles and brand marks into client defaults."));

if (import.meta.main) {
  Command.run(generateThemeTokensCommand, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
