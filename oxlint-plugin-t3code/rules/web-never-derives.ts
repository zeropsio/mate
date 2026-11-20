import { defineRule } from "@oxlint/plugins";
import { formatFindingMessage, loadExceptionLedger, shouldReportLedgered } from "../exceptions.ts";
import {
  collectImportStatements,
  type ForbiddenUse,
  globalUse,
  scanSourceLiterals,
  TIMER_USES,
} from "../zoneSource.ts";

const RULE_NAME = "web-never-derives";
const ledger = loadExceptionLedger(RULE_NAME);

// AgentActivity.tsx is structurally exempt because its `"widget"`
// function is serialized and must stay self-contained. Its inline
// tables are kept aligned by AgentActivity.test.ts's shared vectors.
const STATUS_CONSUMERS = new Set([
  "apps/web/src/components/Sidebar.tsx",
  "apps/web/src/components/Sidebar.logic.ts",
  "apps/web/src/components/SidebarThreadRows.tsx",
  "apps/web/src/components/ThreadStatusIndicators.tsx",
  "apps/web/src/components/zerops/crew/CrewLeadPlan.logic.ts",
  "apps/mobile/src/features/threads/thread-list-v2-items.tsx",
  "apps/mobile/src/features/threads/threadListV2.ts",
  "apps/mobile/src/features/agent-awareness/remoteRegistration.ts",
  "infra/relay/src/agentActivity/agentActivityAggregate.ts",
]);

const THREAD_STATUS_PHRASES = [
  "Working",
  "Connecting",
  "Monitoring",
  "Failed",
  "Plan Ready",
  "Done",
  "Woke",
  "Approval",
  "Input",
  "Pending Approval",
  "Awaiting Input",
  "Completed",
  "Waiting",
] as const;

function findLocalThreadStatusPhrases(source: string): ReadonlyArray<string> {
  const phrases = new Set<string>(THREAD_STATUS_PHRASES);
  const found = new Set<string>();
  const { literals, jsxSource } = scanSourceLiterals(source);
  const sortedLiterals = [...literals].sort((left, right) => left.start - right.start);

  for (const literal of sortedLiterals) {
    const value = literal.value.trim();
    if (phrases.has(value)) found.add(value);
  }
  for (let index = 0; index < sortedLiterals.length - 1; index += 1) {
    const left = sortedLiterals[index]!;
    const right = sortedLiterals[index + 1]!;
    if (!/^\s*\+\s*$/u.test(source.slice(left.end, right.start))) continue;
    const value = `${left.value}${right.value}`.trim();
    if (phrases.has(value)) found.add(value);
  }
  for (const match of jsxSource.matchAll(/>([^<>]*)</gsu)) {
    const value = match[1]?.trim() ?? "";
    if (phrases.has(value)) found.add(value);
  }

  return [...found].sort();
}

// The web's inventory provider reads the grant the data runtime interprets (DESIGN §4.2,
// D16(a)): it arms no timer, and runs neither the grant's machine nor its verification reads.
const INVENTORY_PROVIDER_FILE = "apps/web/src/zerops/ZeropsInventoryProvider.tsx";
const GRANT_INTERPRETER_USES: ReadonlyArray<ForbiddenUse> = [
  ...TIMER_USES,
  ...["transitionGrant", "initialGrant", "makeRestAccessVerifier"].map(globalUse),
];

// A Known's `.value` is read only in `cr/zerops` — the
// knowledge kernel, the stores' selectors and the projections — so web and
// mobile render presentations and view models, never a raw value. Without
// types a Known is recognised by its narrowing: an expression compared with
// `.state === "known"` (or `!==`, or switched on with a `case "known"`) whose
// `.value` the same file reads. A Known destructured (`const { value } = …`),
// passed through a helper, or read in a file that never narrows it is a gap;
// inside `cr/zerops` a selector and its store share modules, so no file split
// is checked there.
const NARROWED_EXPRESSION = String.raw`[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*`;
const KNOWN_NARROWING_PATTERNS = [
  new RegExp(String.raw`(${NARROWED_EXPRESSION})\??\.state\s*[!=]==?\s*["']known["']`, "gu"),
  new RegExp(String.raw`["']known["']\s*[!=]==?\s*(${NARROWED_EXPRESSION})\??\.state`, "gu"),
];
const KNOWN_SWITCH_PATTERN = new RegExp(
  String.raw`switch\s*\(\s*(${NARROWED_EXPRESSION})\??\.state\s*\)`,
  "gu",
);
const KNOWN_CASE_PATTERN = /case\s*["']known["']/u;

function knownNarrowings(source: string): ReadonlySet<string> {
  const narrowed = new Set<string>();
  for (const pattern of KNOWN_NARROWING_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      narrowed.add(match[1]!.replaceAll("?.", "."));
    }
  }
  if (KNOWN_CASE_PATTERN.test(source)) {
    for (const match of source.matchAll(KNOWN_SWITCH_PATTERN)) {
      narrowed.add(match[1]!.replaceAll("?.", "."));
    }
  }
  return narrowed;
}

const READINESS_OWNERS =
  /\b(?:function|const)\s+(mateComing|mateComingPage|arrivalHoldsThrough|arrivalAwaitsAnswer|arrivalLinkHolds|mateArrivalShown|firstBuildState|firstBuildTargets|firstBuildsOf|listingLacksCreation|recoveryNotice)\b/gu;
const READINESS_IMPORTS =
  /import\s+[^;]*\b(?:mateComing|mateComingPage|arrivalHoldsThrough|arrivalAwaitsAnswer|arrivalLinkHolds|mateArrivalShown)\b[^;]*from/gu;
const READINESS_IMPORT_NAMES =
  /\b(?:mateComing|mateComingPage|arrivalHoldsThrough|arrivalAwaitsAnswer|arrivalLinkHolds|mateArrivalShown)\b/gu;

// Each readiness name is its own finding, so a ledgered name never covers another one in the file.
function readinessNames(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(READINESS_OWNERS)) names.add(match[1]!);
  for (const statement of source.matchAll(READINESS_IMPORTS)) {
    for (const name of statement[0].matchAll(READINESS_IMPORT_NAMES)) names.add(name[0]);
  }
  return [...names].toSorted();
}

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Web and mobile consumers render runtime-owned values, grants, thread status and readiness.",
    },
  },
  create(context) {
    const path = /(?:^|\/)((?:apps\/(?:web|mobile)|infra\/relay)\/src\/.+\.tsx?)$/u.exec(
      context.filename.replaceAll("\\", "/"),
    )?.[1];
    if (!path || /\.test\.tsx?$/u.test(path)) return {};
    const statusConsumer = STATUS_CONSUMERS.has(path);
    const client = path.startsWith("apps/");
    if (!client && !statusConsumer) return {};

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
        const source = context.sourceCode.text;
        if (client) {
          for (const expression of knownNarrowings(source)) {
            const segments = expression
              .split(".")
              .map((segment) => segment.replaceAll("$", String.raw`\$`));
            const valueRead = new RegExp(
              String.raw`(?<![\w$.])${segments.join(String.raw`\??\.`)}\??\.value(?![\w$])`,
              "u",
            );
            if (valueRead.test(source)) {
              report(
                "known-value",
                `${expression}.value`,
                `Read ${expression}.value in the runtime selector.`,
              );
            }
          }
        }
        if (path === INVENTORY_PROVIDER_FILE) {
          const code = scanSourceLiterals(source).jsxSource;
          for (const { name, pattern } of GRANT_INTERPRETER_USES) {
            if (pattern.test(code)) report("grant", name, `The inventory provider uses ${name}.`);
          }
        }
        if (statusConsumer) {
          const importsSharedStatus = collectImportStatements(source).some(
            ({ specifier }) =>
              specifier === "@t3tools/shared/threadStatus" ||
              specifier === "@t3tools/client-runtime/zerops/statusPresentation",
          );

          if (!importsSharedStatus)
            report("status-import", "shared status", "Import the shared thread status resolver.");
          for (const phrase of findLocalThreadStatusPhrases(source)) {
            report(
              "status-phrase",
              phrase,
              `The status consumer contains the local phrase "${phrase}".`,
            );
          }
        }
        if (path.startsWith("apps/web/src/") && !/\.scenario\.tsx?$/u.test(path)) {
          for (const name of readinessNames(source)) {
            report(
              "readiness",
              name,
              `Web consumers must read readiness from the runtime: ${name}.`,
            );
          }
        }
      },
    };
  },
});
