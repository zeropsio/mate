// @effect-diagnostics nodeBuiltinImport:off -- Oxlint follows relative value imports synchronously.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { defineRule } from "@oxlint/plugins";
import { formatFindingMessage, loadExceptionLedger, shouldReportLedgered } from "../exceptions.ts";
import {
  collectDynamicImportArguments,
  collectImportStatements,
  type ForbiddenUse,
  globalUse,
  IMPORT_ASSIGNMENT_PATTERN,
  scanSourceLiterals,
  TIMER_USES,
} from "../zoneSource.ts";

const RULE_NAME = "zerops-runtime-zones";
const ledger = loadExceptionLedger(RULE_NAME);
const CLIENT_RUNTIME_ZEROPS_DIR = "packages/client-runtime/src/zerops";
const UI_IMPORT_PREFIXES = [
  "react",
  "react-dom",
  "react-native",
  "expo",
  "expo-",
  "@effect/atom-react",
] as const;

// Effect modules that compute values and run nothing. Every other `effect`
// module (Effect, Stream, Layer, Fiber, Schedule, Clock, Schema, the bare
// `effect` barrel, …) and every other package is out of bounds for a value
// import from a pure zone; a type-only import of any of them is allowed.
const PURE_EFFECT_MODULES: ReadonlySet<string> = new Set([
  "effect/Array",
  "effect/Equal",
  "effect/Equivalence",
  "effect/Function",
  "effect/Hash",
  "effect/Option",
  "effect/Order",
  "effect/Predicate",
  "effect/Record",
  "effect/Result",
  "effect/Struct",
]);

// Shared modules that compute values, import only other pure shared modules and run nothing.
const PURE_SHARED_MODULES: ReadonlySet<string> = new Set([
  "@t3tools/shared/basePath",
  "@t3tools/shared/brand",
  "@t3tools/shared/mateFaces",
  "@t3tools/shared/messagePreview",
  "@t3tools/shared/semver",
]);

const NETWORK_AND_STORAGE_USES: ReadonlyArray<ForbiddenUse> = [
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "localStorage",
  "sessionStorage",
  "indexedDB",
].map(globalUse);

// Reads of the wall or the monotonic clock. Time reaches a machine, reducer or
// pure projection only through `ctx.now`.
const CLOCK_READS: ReadonlyArray<ForbiddenUse> = [
  { name: "Date.now", pattern: /(?<![\w$])Date\s*\.\s*now(?![\w$])/u },
  { name: "performance.now", pattern: /(?<![\w$])performance\s*\.\s*now(?![\w$])/u },
  // `new Date()` and `new Date` read the clock; `new Date(value)` does not.
  { name: "new Date()", pattern: /(?<![\w$])new\s+Date(?![\w$])(?!\s*\(\s*[^\s)])/u },
];

const FORBIDDEN_USES: ReadonlyArray<ForbiddenUse> = [
  ...NETWORK_AND_STORAGE_USES,
  ...TIMER_USES,
  ...CLOCK_READS,
];

interface PureZone {
  readonly contains: (zeropsRelativeFile: string) => boolean;
}

// `knowledge/` ports and the invalidation bus are drivers, not reducers.
const KNOWLEDGE_DRIVER_FILES: ReadonlySet<string> = new Set([
  "knowledge/invalidation.ts",
  "knowledge/signals.ts",
]);

// Rule 2: machine and reducer files import no Effect runtime, fetch or
// storage, read no clock and set no timer.
const MACHINE_ZONE: PureZone = {
  contains: (file) =>
    (file.startsWith("knowledge/") && !KNOWLEDGE_DRIVER_FILES.has(file)) ||
    file === "environments/reachability.ts" ||
    file === "environments/gate.ts" ||
    /Machine\.tsx?$/u.test(file),
};

// Rule 3: projections and the named pure modules are pure — no Effect runtime,
// fetch, storage, clock or timers.
const PURE_PROJECTION_ZONE: PureZone = {
  contains: (file) =>
    file.startsWith("projections/") ||
    file === "flow/groupFlow.ts" ||
    file === "environments/reachability.ts" ||
    file === "environments/gate.ts",
};

// Rule 6: dependencies run one way — data ← environments ← flow — and nothing under `cr/zerops`
// depends on `account/` except `account/` itself and the `testing/` harness, which drives sessions.
// Every import edge counts, type-only included: the rule is about the module
// graph, not the emitted code. Test files are not part of the graph.
const FORBIDDEN_LAYER_EDGES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["data", new Set(["environments", "flow"])],
  ["environments", new Set(["flow"])],
]);

const ACCOUNT_RUNTIME_FILE = "packages/client-runtime/src/data/accountRuntime/accountRuntime.ts";
const ACCOUNT_RUNTIME_CONSTRUCTORS: ReadonlyArray<string> = [
  "makeInvalidationBus",
  "connectCrossTabInvalidations",
  "makeRegistrationRecords",
  "makeContainerStore",
  "makeExchangeDriver",
  "makeStops",
];

const constructorCalls = ACCOUNT_RUNTIME_CONSTRUCTORS.map((name) => ({
  name,
  pattern: new RegExp(`(?<![\\w$])(?<!function\\s+)${name}\\s*\\(`, "u"),
}));

function resolveImport(file: string, specifier: string): string | undefined {
  const target = NodePath.resolve(NodePath.dirname(file), specifier);
  const candidates = /\.(?:tsx?|json)$/u.test(target)
    ? [target]
    : [
        `${target}.ts`,
        `${target}.tsx`,
        NodePath.join(target, "index.ts"),
        NodePath.join(target, "index.tsx"),
      ];
  return candidates.find((candidate) => NodeFS.existsSync(candidate));
}

function inspectSource(source: string) {
  const { jsxSource, commentFree } = scanSourceLiterals(source);
  const dynamicImports = collectDynamicImportArguments(source, commentFree);
  return {
    code: jsxSource,
    imports: collectImportStatements(source, dynamicImports),
    hasDynamicImport: dynamicImports.length > 0,
    hasImportAssignment: source.search(IMPORT_ASSIGNMENT_PATTERN) !== -1,
  };
}

function walkPureImports(
  root: string,
  rootSource: ReturnType<typeof inspectSource>,
  report: (file: string, reason: string) => void,
) {
  const visited = new Set<string>();
  const pending = [root];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const source = file === root ? rootSource : inspectSource(NodeFS.readFileSync(file, "utf8"));
    for (const use of FORBIDDEN_USES) {
      if (use.pattern.test(source.code)) report(file, `uses ${use.name}`);
    }
    if (source.hasDynamicImport) report(file, "uses a dynamic import");
    if (source.hasImportAssignment) report(file, "uses a TypeScript import assignment");
    for (const { specifier, typeOnly } of source.imports) {
      if (typeOnly) continue;
      if (specifier.startsWith(".")) {
        const target = resolveImport(file, specifier);
        if (target === undefined)
          report(file, `imports ${specifier}, which does not resolve to a module`);
        else if (/\.tsx?$/u.test(target)) pending.push(target);
      } else if (!PURE_EFFECT_MODULES.has(specifier) && !PURE_SHARED_MODULES.has(specifier)) {
        report(file, `imports ${specifier}, which is not a pure effect data module`);
      }
    }
  }
}

// Import targets can name a layer directory directly (including its implicit index).
function layerOf(relative: string) {
  const [first, second] = relative.split("/");
  if (!first || first === "." || first === "..") return undefined;
  return second !== undefined || !/\.tsx?$/u.test(first) ? first : undefined;
}

function layerViolation(file: string, specifier: string) {
  if (!specifier.startsWith(".")) return;
  const from = layerOf(file);
  const to = layerOf(NodePath.posix.join(NodePath.posix.dirname(file), specifier));
  if (to === "account" && from !== "account" && from !== "testing") {
    return "only account/ and testing/ may depend on account/";
  }
  if (from && to && FORBIDDEN_LAYER_EDGES.get(from)?.has(to)) {
    return `${from}/ must not depend on ${to}/`;
  }
}

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Enforce Zerops runtime zone boundaries and account constructor ownership.",
    },
  },
  create(context) {
    const filename = NodePath.resolve(context.filename);
    const path =
      /(?:^|\/)((?:packages\/client-runtime|apps\/(?:web|mobile))\/src\/.+\.tsx?)$/u.exec(
        filename.replaceAll("\\", "/"),
      )?.[1];
    if (!path || /\.test\.tsx?$/u.test(path)) return {};

    const zoneFile = path.startsWith(`${CLIENT_RUNTIME_ZEROPS_DIR}/`)
      ? path.slice(CLIENT_RUNTIME_ZEROPS_DIR.length + 1)
      : undefined;
    const checkConstructors = path !== ACCOUNT_RUNTIME_FILE && !path.includes("/__fixtures__/");
    if (!zoneFile && !checkConstructors) return {};

    return {
      Program(node) {
        const report = (kind: string, fingerprint: string, summary: string) => {
          const ledgered = ledger.has({ path, kind, fingerprint });
          if (ledgered && !shouldReportLedgered()) return;
          context.report({
            node,
            message: formatFindingMessage({
              ruleName: RULE_NAME,
              kind,
              fingerprint,
              summary,
              ledgered,
            }),
          });
        };
        const text = context.sourceCode.text;
        const source = zoneFile ? inspectSource(text) : undefined;
        if (checkConstructors) {
          const possibleCalls = constructorCalls.filter(({ name }) => text.includes(name));
          if (possibleCalls.length > 0) {
            const code = source?.code ?? scanSourceLiterals(text).jsxSource;
            for (const { name, pattern } of possibleCalls) {
              if (pattern.test(code))
                report("constructor", name, `Only the account runtime constructs ${name}.`);
            }
          }
        }
        if (!zoneFile || !source) return;
        for (const { specifier } of source.imports) {
          if (UI_IMPORT_PREFIXES.some((prefix) => specifier.startsWith(prefix))) {
            report("ui-import", specifier, `The UI-free Zerops runtime imports ${specifier}.`);
          }
          const violation = layerViolation(zoneFile, specifier);
          if (violation) report("layer", specifier, `${specifier}: ${violation}.`);
        }

        const machine = MACHINE_ZONE.contains(zoneFile);
        const projection = PURE_PROJECTION_ZONE.contains(zoneFile);
        if (machine || projection) {
          const repoRoot = filename.slice(0, -path.length);
          walkPureImports(filename, source, (file, reason) => {
            const finding = `${NodePath.relative(repoRoot, file).split(NodePath.sep).join("/")} ${reason}`;
            if (machine)
              report("machine", finding, `Machines and reducers must be pure: ${finding}.`);
            if (projection)
              report(
                "projection",
                finding,
                `Projections and named pure modules must be pure: ${finding}.`,
              );
          });
        }
      },
    };
  },
});
