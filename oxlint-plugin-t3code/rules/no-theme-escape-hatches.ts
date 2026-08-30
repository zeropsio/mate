import { defineRule, type ESTree, type Variable } from "@oxlint/plugins";
import * as Option from "effect/Option";

import {
  formatFindingMessage,
  loadExceptionLedger,
  normalizeFingerprint,
  shouldReportLedgered,
} from "../exceptions.ts";
import {
  classAttributeName,
  createClassLikeMatcher,
  getPropertyName,
  resolveVariable,
  unwrapExpression,
} from "../utils.ts";

const RULE_NAME = "no-theme-escape-hatches";
const LEDGER_DIRECTORY_ENV = "T3CODE_THEME_ESCAPE_HATCHES_LEDGER_DIRECTORY";
const WEB_SOURCE_MARKER = "/apps/web/src/";
const MOBILE_SOURCE_MARKER = "/apps/mobile/src/";
const SKIPPED_FILE_PATTERN = /\.(?:stories|test)\.[^/]+$/u;
const APPEARANCE_VARIANT_PATTERN = /\b(?:dark|light):(?=\S)/u;
const RAW_COLOR_PATTERN =
  /#[0-9a-fA-F]{3,8}(?![0-9a-fA-F])|\b(?:rgb|rgba|hsl|hsla|oklch)\(\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)/u;
const DYNAMIC_RAW_COLOR_START_PATTERN = /^\s*(?:#|rgba?\(|hsla?\(|oklch\()/u;
const COLOR_UTILITY_PREFIX =
  "(?:text|bg|border|ring|fill|stroke|from|to|via|outline|shadow|accent|caret|decoration|divide|placeholder|ring-offset)";
const COLOR_UTILITY = `(?:${COLOR_UTILITY_PREFIX}|border-(?:x|y|s|e|t|r|b|l)|divide-(?:x|y))`;
const PALETTE_COLOR =
  "(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)";
const SPECIAL_COLOR = "(?:white|black)";
const ARBITRARY_RAW_COLOR_PATTERN = new RegExp(
  `(?:^|[_,([:])(?:` +
    `#[0-9a-fA-F]{3,8}(?![0-9a-fA-F])|` +
    `(?:rgb|rgba|hsl|hsla|oklch)\\(\\s*[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)|` +
    `(?:${PALETTE_COLOR}|${SPECIAL_COLOR})(?![a-zA-Z0-9-]))`,
  "u",
);
const OPACITY_MODIFIER = "(?:/(?:\\d{1,3}|\\[[^\\]\\s]+\\]))?";
const TRAILING_OPACITY_MODIFIER_PATTERN = /\/(?:\d{1,3}|\[[^\]\s]+\])$/u;
const TAILWIND_PALETTE_TOKEN_PATTERN = new RegExp(
  `^!?(?:${COLOR_UTILITY}-${PALETTE_COLOR}-\\d{2,3}${OPACITY_MODIFIER}|` +
    `${COLOR_UTILITY}-${SPECIAL_COLOR}${OPACITY_MODIFIER})!?$`,
  "u",
);
const DYNAMIC_TAILWIND_PALETTE_TOKEN_PATTERN = new RegExp(
  `^!?${COLOR_UTILITY}-\\$\\{[^}]+\\}-\\d{2,3}${OPACITY_MODIFIER}!?$`,
  "u",
);
const JSX_COLOR_ATTRIBUTES = new Set([
  "fill",
  "stroke",
  "stopColor",
  "color",
  "floodColor",
  "lightingColor",
]);
const STYLE_COLOR_KEYS = new Set([
  "color",
  "backgroundColor",
  "background",
  "borderColor",
  "outlineColor",
  "fill",
  "stroke",
  "stopColor",
  "shadowColor",
  "tintColor",
  "textDecorationColor",
  "caretColor",
  "placeholderTextColor",
]);
const ZERO_TOLERANCE_MARKERS = [
  "/apps/web/src/zerops/",
  "/apps/web/src/components/zerops/",
  "/apps/mobile/src/features/zerops/",
] as const;

/**
 * Status tables are widened sinks with an F3 baseline. AgentActivity is intentionally not zero
 * tolerance: its native inline hex tints cannot move to semantic tokens before the F4/F5 work.
 * This intentionally also catches hex-shaped ids, SVG data, and commit references in these files.
 */
const STATUS_CONSUMER_MODULES = [
  "/apps/web/src/components/Sidebar.tsx",
  "/apps/web/src/components/Sidebar.logic.ts",
  "/apps/web/src/components/ThreadStatusIndicators.tsx",
  "/apps/mobile/src/widgets/AgentActivity.tsx",
  "/apps/mobile/src/features/threads/threadListV2.ts",
  "/apps/mobile/src/features/threads/thread-list-v2-items.tsx",
] as const;

/** These modules define the semantic roles protected by this rule, so their palettes are sources. */
const THEME_SOURCE_MODULES = [
  "/packages/shared/src/themePalettes.ts",
  "/apps/web/src/themePalette.ts",
  "/apps/mobile/src/lib/mobileTheme.ts",
] as const;

const normalizedFilename = (filename: string): string => `/${filename.replaceAll("\\", "/")}`;

const sourceMarker = (filename: string): string | undefined => {
  if (filename.lastIndexOf(WEB_SOURCE_MARKER) !== -1) return WEB_SOURCE_MARKER;
  if (filename.lastIndexOf(MOBILE_SOURCE_MARKER) !== -1) return MOBILE_SOURCE_MARKER;
  return undefined;
};

const literalStringValue = (node: unknown): Option.Option<string> => {
  if (typeof node !== "object" || node === null) return Option.none();
  if (!("type" in node) || node.type !== "Literal") return Option.none();
  if (!("value" in node) || typeof node.value !== "string") return Option.none();
  return Option.some(node.value);
};

const importsModule = (source: string, modulePath: string): boolean =>
  source.replace(/\.[cm]?[jt]sx?$/u, "").endsWith(modulePath);

const isStyleColorKey = (key: string): boolean =>
  STYLE_COLOR_KEYS.has(key) || /^border.*Color$/u.test(key);

const directValueContainer = (node: ESTree.Node): ESTree.Node =>
  node.type === "TemplateElement" ? node.parent : node;

const directPropertySink = (node: ESTree.Node): string | undefined => {
  const container = directValueContainer(node);
  const parent = container.parent;
  if (parent === null || parent.type !== "Property" || !("value" in parent) || !("key" in parent)) {
    return undefined;
  }

  const value = unwrapExpression(parent.value);
  if (Option.isNone(value) || value.value !== container) return undefined;

  const key = getPropertyName(parent.key);
  if (Option.isNone(key)) return undefined;
  return key.value.startsWith("--") || isStyleColorKey(key.value) ? key.value : undefined;
};

const directJsxAttributeSink = (node: ESTree.Node): string | undefined => {
  let container = directValueContainer(node);
  if (container.parent?.type === "JSXExpressionContainer") container = container.parent;
  if (container.parent === null) return undefined;
  const attributeName = classAttributeName(container.parent);
  return attributeName !== undefined && JSX_COLOR_ATTRIBUTES.has(attributeName)
    ? attributeName
    : undefined;
};

const withoutUrls = (value: string): string => value.replace(/\burl\([^)]*\)/giu, "");

const withoutQuotedSubstrings = (value: string): string => {
  let result = "";
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote === undefined) {
      if (character === "'" || character === '"') quote = character;
      else result += character;
      continue;
    }

    if (character === "\\") index += 1;
    else if (character === quote) quote = undefined;
  }
  return result;
};

const withoutNonColorPayloads = (value: string): string =>
  withoutQuotedSubstrings(withoutUrls(value));

const normalizeArbitraryToken = (token: string): string => {
  const withoutImportant = token.endsWith("!") ? token.slice(0, -1) : token;
  return withoutImportant
    .replace(TRAILING_OPACITY_MODIFIER_PATTERN, "")
    .replace(/(^|:)!\[/u, "$1[");
};

const tailwindUtility = (token: string): string | undefined => {
  let bracketDepth = 0;
  let utilityStart = 0;
  for (let index = 0; index < token.length; index += 1) {
    const character = token[index];
    if (character === "[") bracketDepth += 1;
    else if (character === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (character === ":" && bracketDepth === 0) {
      if (index === utilityStart) return undefined;
      utilityStart = index + 1;
    }
  }
  return bracketDepth === 0 ? token.slice(utilityStart) : undefined;
};

const hasPaletteToken = (value: string): boolean =>
  value.split(/\s+/u).some((token) => {
    const utility = tailwindUtility(token);
    return utility !== undefined && TAILWIND_PALETTE_TOKEN_PATTERN.test(utility);
  });

const closingBracket = (value: string, openingBracket: number): number | undefined => {
  let bracketDepth = 0;
  let quote: "'" | '"' | undefined;
  for (let index = openingBracket; index < value.length; index += 1) {
    const character = value[index];
    if (quote !== undefined) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "[") bracketDepth += 1;
    else if (character === "]") {
      bracketDepth -= 1;
      if (bracketDepth === 0) return index;
    }
  }
  return undefined;
};

const hasArbitraryColorToken = (value: string): boolean =>
  value.split(/\s+/u).some((token) => {
    const utility = tailwindUtility(token);
    if (utility === undefined) return false;
    const normalized = normalizeArbitraryToken(utility);
    const arbitraryValueStart = normalized.indexOf("-[");
    if (arbitraryValueStart !== -1) {
      const openingBracket = arbitraryValueStart + 1;
      const closing = closingBracket(normalized, openingBracket);
      if (closing !== normalized.length - 1) return false;
      return ARBITRARY_RAW_COLOR_PATTERN.test(
        withoutNonColorPayloads(normalized.slice(openingBracket + 1, closing)),
      );
    }

    if (!normalized.startsWith("[")) return false;
    const closing = closingBracket(normalized, 0);
    if (closing !== normalized.length - 1) return false;
    const propertyValue = normalized.slice(1, closing);
    const colon = propertyValue.indexOf(":");
    return (
      colon > 0 &&
      ARBITRARY_RAW_COLOR_PATTERN.test(withoutNonColorPayloads(propertyValue.slice(colon + 1)))
    );
  });

const hasDynamicPaletteToken = (source: string): boolean =>
  source
    .slice(1, -1)
    .split(/\s+/u)
    .some((token) => {
      const utility = tailwindUtility(token);
      return utility !== undefined && DYNAMIC_TAILWIND_PALETTE_TOKEN_PATTERN.test(utility);
    });

const ledgerDirectory = globalThis.process.env[LEDGER_DIRECTORY_ENV];
const ledger = loadExceptionLedger(RULE_NAME, ledgerDirectory);

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Keep web and mobile styling on semantic theme tokens, with fingerprinted exceptions for existing chrome.",
    },
  },
  create(context) {
    const filename = normalizedFilename(context.filename);
    if (THEME_SOURCE_MODULES.some((candidate) => filename.endsWith(candidate))) return {};

    const marker = sourceMarker(filename);
    if (marker === undefined || SKIPPED_FILE_PATTERN.test(filename)) {
      return {};
    }

    const isMobile = marker === MOBILE_SOURCE_MARKER;
    const zeroTolerance = ZERO_TOLERANCE_MARKERS.some((candidate) => filename.includes(candidate));
    const statusConsumer = STATUS_CONSUMER_MODULES.some((candidate) =>
      filename.endsWith(candidate),
    );
    const isClassLike = createClassLikeMatcher(context);
    const uniwindNamespaces = new Set<Variable>();

    const reportFinding = (
      node: ESTree.Node,
      summary: string,
      fingerprintNode: ESTree.Node = node,
    ) => {
      const kind = node.type;
      const fingerprint = normalizeFingerprint(
        context.sourceCode.text.slice(fingerprintNode.start, fingerprintNode.end),
      );
      const ledgered = !zeroTolerance && ledger.has({ path: context.filename, kind, fingerprint });
      if (ledgered && !shouldReportLedgered()) return;

      context.report({
        node,
        message: formatFindingMessage({
          ruleName: RULE_NAME,
          summary,
          kind,
          fingerprint,
          ledgered,
        }),
      });
    };

    const reportStringFinding = ({
      node,
      values,
      fingerprintNode,
      semanticSink,
      dynamicRawColor = false,
    }: {
      readonly node: ESTree.Node;
      readonly values: ReadonlyArray<string>;
      readonly fingerprintNode: ESTree.Node;
      readonly semanticSink: string | undefined;
      readonly dynamicRawColor?: boolean;
    }) => {
      const classLike = isClassLike(fingerprintNode);
      const source = context.sourceCode.text.slice(fingerprintNode.start, fingerprintNode.end);
      const palette =
        values.some((value) => hasPaletteToken(value) || hasArbitraryColorToken(value)) ||
        (classLike && hasDynamicPaletteToken(source));
      const appearance = values.some((value) => APPEARANCE_VARIANT_PATTERN.test(value));
      const rawColor =
        values.some((value) => RAW_COLOR_PATTERN.test(withoutUrls(value))) ||
        (semanticSink !== undefined && dynamicRawColor);
      const semanticRawColor = semanticSink !== undefined && rawColor;
      const statusValue = statusConsumer && (palette || appearance || rawColor);
      const mobileAppearance = isMobile && appearance;
      const classValue = classLike && (palette || appearance);
      if (!semanticRawColor && !statusValue && !mobileAppearance && !classValue) return;

      const findings = [
        rawColor ? "raw colour" : undefined,
        palette ? "Tailwind palette utility" : undefined,
        appearance ? "dark:/light: variant" : undefined,
      ].filter((candidate): candidate is string => candidate !== undefined);
      const sink = statusValue
        ? "named status table"
        : semanticRawColor
          ? `${semanticSink} semantic sink`
          : mobileAppearance && !classLike
            ? "mobile string"
            : "class-like literal";
      reportFinding(
        node,
        `${findings.join(", ")} in a ${sink} bypasses adaptive semantic theme tokens.`,
        fingerprintNode,
      );
    };

    return {
      ImportDeclaration(node) {
        if (!isMobile) return;
        const source = literalStringValue(node.source);
        if (Option.isNone(source)) return;
        const declaredVariables = context.sourceCode.getDeclaredVariables(node);

        for (const specifier of node.specifiers) {
          const local = unwrapExpression(specifier.local);
          const importedName =
            specifier.type === "ImportSpecifier"
              ? getPropertyName(specifier.imported)
              : Option.none();
          const isTypeOnly =
            node.importKind === "type" ||
            (specifier.type === "ImportSpecifier" && specifier.importKind === "type");
          if (isTypeOnly) continue;

          if (
            specifier.type === "ImportNamespaceSpecifier" &&
            Option.isSome(local) &&
            local.value.type === "Identifier"
          ) {
            const localName = local.value.name;
            const variable = declaredVariables.find((candidate) => candidate.name === localName);
            if (source.value === "uniwind" && variable !== undefined) {
              uniwindNamespaces.add(variable);
            }
          }

          if (
            source.value === "uniwind" &&
            Option.isSome(importedName) &&
            importedName.value === "useCSSVariable"
          ) {
            reportFinding(
              specifier,
              "useCSSVariable adds a React theme subscription; use a semantic className instead.",
            );
          }

          if (importsModule(source.value, "/useThemeColor")) {
            reportFinding(
              specifier,
              "useThemeColor bypasses semantic Uniwind classes and is no longer a theme boundary.",
            );
          }

          if (importsModule(source.value, "/useUniwindTheme")) {
            reportFinding(
              specifier,
              "useUniwindTheme is allowed only at a reviewed native/third-party interop boundary.",
            );
          }
        }
      },
      MemberExpression(node) {
        if (!isMobile) return;
        const object = unwrapExpression(node.object);
        if (Option.isNone(object) || object.value.type !== "Identifier") return;

        const property = getPropertyName(node.property);
        if (Option.isNone(property)) return;
        const namespace = resolveVariable(context, object.value);
        if (
          namespace !== undefined &&
          uniwindNamespaces.has(namespace) &&
          property.value === "useCSSVariable"
        ) {
          reportFinding(
            node,
            "useCSSVariable adds a React theme subscription; use a semantic className instead.",
          );
        }
      },
      VariableDeclarator(node) {
        if (!isMobile) return;
        const initializer = unwrapExpression(node.init);
        const binding = unwrapExpression(node.id);
        if (
          Option.isNone(initializer) ||
          initializer.value.type !== "Identifier" ||
          Option.isNone(binding)
        ) {
          return;
        }

        const namespace = resolveVariable(context, initializer.value);
        if (namespace === undefined || !uniwindNamespaces.has(namespace)) return;

        if (binding.value.type === "Identifier") {
          const bindingName = binding.value.name;
          const variable = context.sourceCode
            .getDeclaredVariables(node)
            .find((candidate) => candidate.name === bindingName);
          if (variable !== undefined) uniwindNamespaces.add(variable);
          return;
        }

        if (binding.value.type !== "ObjectPattern") return;
        const declaredVariables = context.sourceCode.getDeclaredVariables(node);
        for (const propertyNode of binding.value.properties) {
          if (propertyNode.type === "RestElement") {
            const restBinding = unwrapExpression(propertyNode.argument);
            if (Option.isNone(restBinding) || restBinding.value.type !== "Identifier") continue;
            const restName = restBinding.value.name;
            const variable = declaredVariables.find((candidate) => candidate.name === restName);
            if (variable !== undefined) uniwindNamespaces.add(variable);
            continue;
          }

          if (propertyNode.type !== "Property") continue;
          const property = getPropertyName(propertyNode.key);
          if (Option.isSome(property) && property.value === "useCSSVariable") {
            reportFinding(
              propertyNode,
              "useCSSVariable adds a React theme subscription; use a semantic className instead.",
            );
          }
        }
      },
      Literal(node) {
        if (typeof node.value !== "string") return;
        reportStringFinding({
          node,
          values: [node.value],
          fingerprintNode: node,
          semanticSink: directPropertySink(node) ?? directJsxAttributeSink(node),
        });
      },
      TemplateElement(node) {
        const template = node.parent;
        if (template.type !== "TemplateLiteral" || template.quasis[0] !== node) return;
        const quasiValues = template.quasis.map((quasi) => quasi.value.cooked ?? "");
        reportStringFinding({
          node,
          values: [...quasiValues, quasiValues.join("${expression}")],
          fingerprintNode: template,
          semanticSink: directPropertySink(node) ?? directJsxAttributeSink(node),
          dynamicRawColor: quasiValues.some((value) => DYNAMIC_RAW_COLOR_START_PATTERN.test(value)),
        });
      },
    };
  },
});
