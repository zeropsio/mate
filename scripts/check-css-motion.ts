#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CSS_KIND,
  cssDeclarationFingerprint,
  formatReconcileReport,
  loadCompletedPhases,
  loadExceptionLedger,
  reconcileExceptions,
  type ExceptionFinding,
} from "@t3tools/oxlint-plugin-t3code/exceptions";
import * as Console from "effect/Console";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import { Command } from "effect/cli";
import * as NodeURL from "node:url";

import { collectCssSources, isGeneratedCssSource, type CssSource } from "./cssSources.ts";

const RULE_NAME = "no-infinite-motion";
const FRAME_RULE_NAME = "no-frame-per-tick";
/** What the compositor animates alone; an animation of anything else ticks on the main thread. */
const COMPOSITED_PROPERTIES = new Set([
  "transform",
  "translate",
  "rotate",
  "scale",
  "opacity",
  "filter",
  "backdrop-filter",
]);
const INFINITE_TOKEN_PATTERN = /(?:^|[^-_a-z0-9])infinite(?=$|[^-_a-z0-9])/iu;
const TARGET_PROPERTIES = new Set(["animation", "animation-name", "animation-iteration-count"]);
const CSS_KEYWORDS = new Set([
  "alternate",
  "alternate-reverse",
  "backwards",
  "both",
  "ease",
  "ease-in",
  "ease-in-out",
  "ease-out",
  "forwards",
  "infinite",
  "initial",
  "inherit",
  "linear",
  "none",
  "normal",
  "paused",
  "revert",
  "reverse",
  "running",
  "step-end",
  "step-start",
  "unset",
]);
const DEFAULT_REPO_ROOT = NodeURL.fileURLToPath(new URL("..", import.meta.url));

interface CssDeclaration {
  readonly property: string;
  readonly value: string;
}

interface CssBlock {
  readonly header: string;
  readonly parent: CssBlock | undefined;
  readonly declarations: Array<CssDeclaration>;
  readonly children: Array<CssBlock>;
}

interface KeyframeStop {
  readonly position: number;
  readonly timing: string | undefined;
}

interface ParsedKeyframes {
  readonly stops: ReadonlyArray<KeyframeStop>;
  /** Every property a stop sets, its own timing aside. */
  readonly properties: ReadonlySet<string>;
}

interface AnimationUse {
  readonly name: string | undefined;
  readonly duration: number | undefined;
  readonly timing: string | undefined;
}

export interface CssMotionFinding extends ExceptionFinding {
  readonly detail: string;
}

export interface CssMotionCheckResult {
  readonly report: string;
  readonly problemCount: number;
  readonly exitCode: 0 | 1;
}

class CssMotionCheckError extends Data.TaggedClass("CssMotionCheckError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {
  readonly name = "CssMotionCheckError";

  get message(): string {
    return `CSS motion check failed while ${this.operation}.`;
  }
}

const withoutComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//gu, " ").trim();

const declarationFrom = (text: string): CssDeclaration | undefined => {
  const cleaned = withoutComments(text);
  const colonIndex = cleaned.indexOf(":");
  if (colonIndex <= 0) return undefined;
  const property = cleaned.slice(0, colonIndex).trim().toLowerCase();
  const value = cleaned.slice(colonIndex + 1).trim();
  return property.length > 0 && value.length > 0 ? { property, value } : undefined;
};

const parseCssBlocks = (source: string): CssBlock => {
  const root: CssBlock = {
    header: "<root>",
    parent: undefined,
    declarations: [],
    children: [],
  };
  const stack: Array<{ readonly block: CssBlock; segmentStart: number }> = [
    { block: root, segmentStart: 0 },
  ];
  let quote: '"' | "'" | undefined;
  let parentheses = 0;
  let brackets = 0;

  for (let index = 0; index < source.length; index++) {
    const character = source[index]!;
    const next = source[index + 1];
    if (quote !== undefined) {
      if (character === "\\") index++;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "/" && next === "*") {
      const commentEnd = source.indexOf("*/", index + 2);
      index = commentEnd === -1 ? source.length : commentEnd + 1;
      continue;
    }
    if (character === "(") parentheses++;
    else if (character === ")") parentheses = Math.max(0, parentheses - 1);
    else if (character === "[") brackets++;
    else if (character === "]") brackets = Math.max(0, brackets - 1);
    if (parentheses > 0 || brackets > 0) continue;

    const frame = stack.at(-1)!;
    if (character === "{") {
      const block: CssBlock = {
        header: withoutComments(source.slice(frame.segmentStart, index)),
        parent: frame.block,
        declarations: [],
        children: [],
      };
      frame.block.children.push(block);
      stack.push({ block, segmentStart: index + 1 });
    } else if (character === ";") {
      const declaration = declarationFrom(source.slice(frame.segmentStart, index));
      if (declaration !== undefined) frame.block.declarations.push(declaration);
      frame.segmentStart = index + 1;
    } else if (character === "}" && stack.length > 1) {
      const declaration = declarationFrom(source.slice(frame.segmentStart, index));
      if (declaration !== undefined) frame.block.declarations.push(declaration);
      stack.pop();
      stack.at(-1)!.segmentStart = index + 1;
    }
  }

  return root;
};

const walkBlocks = (root: CssBlock): ReadonlyArray<CssBlock> => {
  const blocks: Array<CssBlock> = [];
  const visit = (block: CssBlock) => {
    blocks.push(block);
    for (const child of block.children) visit(child);
  };
  visit(root);
  return blocks;
};

const splitTopLevelCommas = (value: string): ReadonlyArray<string> => {
  const items: Array<string> = [];
  let start = 0;
  let quote: '"' | "'" | undefined;
  let parentheses = 0;
  let brackets = 0;

  for (let index = 0; index < value.length; index++) {
    const character = value[index]!;
    if (quote !== undefined) {
      if (character === "\\") index++;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(") parentheses++;
    else if (character === ")") parentheses = Math.max(0, parentheses - 1);
    else if (character === "[") brackets++;
    else if (character === "]") brackets = Math.max(0, brackets - 1);
    else if (character === "," && parentheses === 0 && brackets === 0) {
      items.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  items.push(value.slice(start).trim());
  return items.filter((item) => item.length > 0);
};

const keyframePosition = (selector: string): number | undefined => {
  const normalized = selector.trim();
  if (/^from$/iu.test(normalized)) return 0;
  if (/^to$/iu.test(normalized)) return 100;
  const percentage = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))%$/u.exec(normalized);
  if (percentage === null) return undefined;
  const position = Number(percentage[1]);
  return position >= 0 && position <= 100 ? position : undefined;
};

const keyframesFrom = (blocks: ReadonlyArray<CssBlock>): ReadonlyMap<string, ParsedKeyframes> => {
  const keyframes = new Map<string, ParsedKeyframes>();
  for (const block of blocks) {
    const match = /^@(?:-[a-z]+-)?keyframes\s+([_a-zA-Z][-_a-zA-Z0-9]*)$/u.exec(block.header);
    if (match === null) continue;
    const authoredStops = block.children.flatMap((stop) => {
      const timing = stop.declarations
        .toReversed()
        .find((declaration) => declaration.property === "animation-timing-function")?.value;
      return splitTopLevelCommas(stop.header).flatMap((selector) => {
        const position = keyframePosition(selector);
        return position === undefined ? [] : [{ position, timing }];
      });
    });
    const positions = new Set(authoredStops.map((stop) => stop.position));
    const stops = [
      ...(positions.has(0) ? [] : [{ position: 0, timing: undefined }]),
      ...authoredStops,
      ...(positions.has(100) ? [] : [{ position: 100, timing: undefined }]),
    ].toSorted((left, right) => left.position - right.position);
    const properties = new Set(
      block.children.flatMap((stop) =>
        stop.declarations
          .map((declaration) => declaration.property)
          .filter((property) => property !== "animation-timing-function"),
      ),
    );
    keyframes.set(match[1]!, { stops, properties });
  }
  return keyframes;
};

const insideKeyframes = (block: CssBlock): boolean => {
  let current: CssBlock | undefined = block;
  while (current !== undefined) {
    if (/^@(?:-[a-z]+-)?keyframes\s+/u.test(current.header)) return true;
    current = current.parent;
  }
  return false;
};

const identifierTokens = (value: string): ReadonlyArray<string> =>
  [...value.matchAll(/[_a-zA-Z][-_a-zA-Z0-9]*/gu)].map((match) => match[0]);

const animationNameFrom = (
  value: string,
  keyframes: ReadonlyMap<string, ParsedKeyframes>,
): string | undefined => {
  const identifiers = identifierTokens(value);
  return (
    identifiers.find((identifier) => keyframes.has(identifier)) ??
    identifiers.find((identifier) => !CSS_KEYWORDS.has(identifier.toLowerCase()))
  );
};

const durationMilliseconds = (value: string): number | undefined => {
  const match = /(?:^|[\s,])(\d*\.?\d+)(ms|s)(?=$|[\s,])/u.exec(value);
  if (match === null) return undefined;
  const amount = Number(match[1]);
  return match[2] === "s" ? amount * 1000 : amount;
};

const timingIsCappedSteps = (value: string): boolean => {
  const match = /^steps\(\s*(\d+)(?:\s*,\s*[-a-z]+)?\s*\)$/iu.exec(value.trim());
  return match !== null && Number(match[1]) >= 1 && Number(match[1]) <= 8;
};

const shorthandTiming = (value: string): string | undefined =>
  /(?:^|\s)(steps\([^)]*\)|step-start|step-end|linear(?:\([^)]*\))?|ease(?:-in(?:-out)?|-out)?|cubic-bezier\([^)]*\))(?=$|\s)/iu.exec(
    value,
  )?.[1];

const declarationValue = (block: CssBlock, property: string): string | undefined =>
  block.declarations.toReversed().find((candidate) => candidate.property === property)?.value;

const listItem = (value: string | undefined, index: number): string | undefined => {
  if (value === undefined) return undefined;
  const items = splitTopLevelCommas(value);
  return items.length === 0 ? undefined : items[index % items.length];
};

/** Whether one animation of a declaration's list never ends. */
const runsForever = (value: string): boolean => INFINITE_TOKEN_PATTERN.test(value);

const animationUsesFrom = (
  declaration: CssDeclaration,
  block: CssBlock,
  keyframes: ReadonlyMap<string, ParsedKeyframes>,
): ReadonlyArray<AnimationUse> => {
  const values = splitTopLevelCommas(declaration.value);
  const timings = declarationValue(block, "animation-timing-function");
  if (declaration.property === "animation" || declaration.property.startsWith("--animate-")) {
    return values.flatMap((value, index) => {
      if (!runsForever(value)) return [];
      return [
        {
          name: animationNameFrom(value, keyframes),
          duration: durationMilliseconds(value),
          timing: shorthandTiming(value) ?? listItem(timings, index),
        },
      ];
    });
  }

  const names = declarationValue(block, "animation-name");
  const durations = declarationValue(block, "animation-duration");
  return values.flatMap((value, index) => {
    if (!runsForever(value)) return [];
    const nameValue = declaration.property === "animation-name" ? value : listItem(names, index);
    return [
      {
        name: nameValue === undefined ? undefined : animationNameFrom(nameValue, keyframes),
        duration: durationMilliseconds(listItem(durations, index) ?? ""),
        timing: listItem(timings, index),
      },
    ];
  });
};

const firstUnsteppedInterval = (
  keyframes: ParsedKeyframes,
  declaredTiming: string | undefined,
): readonly [KeyframeStop, KeyframeStop] | undefined => {
  for (const [index, stop] of keyframes.stops.entries()) {
    const nextStop = keyframes.stops
      .slice(index + 1)
      .find((candidate) => candidate.position > stop.position);
    if (nextStop !== undefined && !timingIsCappedSteps(stop.timing ?? declaredTiming ?? "ease")) {
      return [stop, nextStop];
    }
  }
  return undefined;
};

const keyframePositionLabel = (stop: KeyframeStop): string => `${stop.position}%`;

const findingDetail = ({
  name,
  keyframes,
  duration,
  timing,
}: {
  readonly name: string | undefined;
  readonly keyframes: ParsedKeyframes | undefined;
  readonly duration: number | undefined;
  readonly timing: string | undefined;
}): string | undefined => {
  if (name === undefined) return "Could not resolve a keyframe name from the infinite animation.";
  if (keyframes === undefined) return `Animation "${name}" has no matching @keyframes block.`;
  const unsteppedInterval = firstUnsteppedInterval(keyframes, timing);
  if (unsteppedInterval !== undefined) {
    const [start, end] = unsteppedInterval;
    return `Animation "${name}" has an unstepped ${keyframePositionLabel(start)}→${keyframePositionLabel(end)} interval; every non-terminal stop must use steps(k) with k no greater than 8.`;
  }
  if (duration === undefined || duration < 1000) {
    return `Animation "${name}" must have a duration of at least 1s.`;
  }
  return undefined;
};

/** Scans one authored CSS source for continuous animation declarations. */
export const scanCssMotion = (path: string, source: string): ReadonlyArray<CssMotionFinding> => {
  if (isGeneratedCssSource(source)) return [];

  const blocks = walkBlocks(parseCssBlocks(source));
  const keyframes = keyframesFrom(blocks);
  const findings: Array<CssMotionFinding> = [];
  for (const block of blocks) {
    if (insideKeyframes(block)) continue;
    for (const declaration of block.declarations) {
      const isTarget =
        TARGET_PROPERTIES.has(declaration.property) ||
        declaration.property.startsWith("--animate-");
      if (!isTarget || !INFINITE_TOKEN_PATTERN.test(declaration.value)) continue;

      for (const animation of animationUsesFrom(declaration, block, keyframes)) {
        const resolvedKeyframes =
          animation.name === undefined ? undefined : keyframes.get(animation.name);
        const detail = findingDetail({ ...animation, keyframes: resolvedKeyframes });
        if (detail === undefined) continue;
        findings.push({
          path,
          kind: CSS_KIND,
          fingerprint: cssDeclarationFingerprint({
            selector: block.header,
            property: declaration.property,
            value: declaration.value,
          }),
          detail,
        });
      }
    }
  }
  return findings;
};

/**
 * Scans one authored CSS source for what costs the main thread a frame on every animation tick
 * while a page is at rest (`t3code/no-frame-per-tick` holds the same guard for scripts): a box with
 * `content-visibility: auto`, which the browser watches as an observer would, and an infinite
 * animation of a property the compositor cannot run, which ticks on the main thread and takes
 * every other animation on the page with it.
 */
export const scanCssFramePerTick = (
  path: string,
  source: string,
): ReadonlyArray<CssMotionFinding> => {
  // Generated CSS is its generator's to change.
  const blocks = isGeneratedCssSource(source) ? [] : walkBlocks(parseCssBlocks(source));
  const keyframes = keyframesFrom(blocks);
  const findings: Array<CssMotionFinding> = [];
  for (const block of blocks) {
    if (insideKeyframes(block)) continue;
    for (const declaration of block.declarations) {
      const finding = (detail: string) => {
        findings.push({
          path,
          kind: CSS_KIND,
          fingerprint: cssDeclarationFingerprint({
            selector: block.header,
            property: declaration.property,
            value: declaration.value,
          }),
          detail,
        });
      };
      if (
        declaration.property === "content-visibility" &&
        /^auto(?:\s*!important)?$/iu.test(declaration.value)
      ) {
        finding(
          "content-visibility: auto makes every animation on the page cost the main thread a frame per tick.",
        );
        continue;
      }
      const isAnimation =
        TARGET_PROPERTIES.has(declaration.property) ||
        declaration.property.startsWith("--animate-");
      if (!isAnimation) continue;

      // Only the infinite ones of a declaration's animations come back.
      for (const animation of animationUsesFrom(declaration, block, keyframes)) {
        const resolved = animation.name === undefined ? undefined : keyframes.get(animation.name);
        // An animation with no keyframes to read is the motion guard's finding, not this one's.
        if (resolved === undefined) continue;
        const uncomposited = [...resolved.properties]
          .filter((property) => !COMPOSITED_PROPERTIES.has(property))
          .toSorted();
        if (uncomposited.length === 0) continue;
        finding(
          `Infinite animation "${animation.name}" animates ${uncomposited.join(", ")}: the compositor runs only transform, translate, rotate, scale, opacity, filter and backdrop-filter, so it ticks on the main thread.`,
        );
      }
    }
  }
  return findings;
};

/** Reconciles scanner output against the CSS portion of the R6 exception ledger. */
export const checkCssMotion = Effect.fn("checkCssMotion")(function* ({
  directory,
  sources,
}: {
  readonly directory: string;
  readonly sources: ReadonlyArray<CssSource>;
}) {
  const completedPhases = yield* Effect.try({
    try: () => loadCompletedPhases(directory),
    catch: (cause) => new CssMotionCheckError({ operation: "loading the ledger", cause }),
  });
  const reports: Array<string> = [];
  let problemCount = 0;
  for (const [ruleName, scan] of [
    [RULE_NAME, scanCssMotion],
    [FRAME_RULE_NAME, scanCssFramePerTick],
  ] as const) {
    const ledger = yield* Effect.try({
      try: () => loadExceptionLedger(ruleName, directory),
      catch: (cause) => new CssMotionCheckError({ operation: "loading the ledger", cause }),
    });
    const findings = sources.flatMap(({ path, source }) =>
      scan(path, source).map((finding) => ({
        ...finding,
        ledgered: ledger.has(finding),
      })),
    );
    const result = reconcileExceptions({
      entries: ledger.entries,
      findings,
      completedPhases,
      scope: "css",
    });
    problemCount +=
      result.unlisted.length + result.dead.length + result.changed.length + result.expired.length;
    reports.push(
      ...findings
        .filter((finding) => !finding.ledgered)
        .map((finding) => `${finding.path}: ${finding.detail}`),
      formatReconcileReport({ ruleName, result }),
    );
  }
  return {
    report: reports.join("\n"),
    problemCount,
    exitCode: problemCount > 0 ? 1 : 0,
  } satisfies CssMotionCheckResult;
});

const runCssMotionCheck = Effect.fn("runCssMotionCheck")(function* () {
  const path = yield* Path.Path;
  const sources = yield* collectCssSources({ repoRoot: DEFAULT_REPO_ROOT });
  const result = yield* checkCssMotion({
    directory: path.join(DEFAULT_REPO_ROOT, "oxlint-plugin-t3code/exceptions"),
    sources,
  });
  yield* Console.log(result.report);
  if (result.exitCode !== 0) {
    yield* Effect.sync(() => {
      process.exitCode = result.exitCode;
    });
  }
});

export const checkCssMotionCommand = Command.make("check-css-motion", {}, runCssMotionCheck).pipe(
  Command.withDescription(
    "Require infinite CSS animation uses to resolve to slow, capped stepped keyframes, and reject what costs a page at rest a frame per animation tick.",
  ),
);

if (import.meta.main) {
  Command.run(checkCssMotionCommand, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
