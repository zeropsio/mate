import { defineRule, type ESTree } from "@oxlint/plugins";

import {
  formatFindingMessage,
  loadExceptionLedger,
  normalizeFingerprint,
  shouldReportLedgered,
} from "../exceptions.ts";
import { compactSyntax, functionNamed, syntaxNodes } from "./boundaries.ts";
import { RETIRED_MECHANISMS, type RetiredMechanism } from "../retiredMechanisms.ts";

/**
 * A mechanism the data-layer rewrite retires gains no new site: every occurrence of a retired
 * token (`retiredMechanisms.ts`) outside comments is reported in the client sources and HQ. Its
 * ledger is the rewrite's remaining work; a site goes when its family moves to the new layer.
 */
const RULE_NAME = "no-retired-mechanism";
const LEDGER_DIRECTORY_ENV = "T3CODE_RETIRED_MECHANISM_LEDGER_DIRECTORY";
/** The token's site in a ledger entry: a text match, not one AST node type. */
const KIND = "retired-token";
const SCOPE_MARKERS = [
  "/apps/web/src/",
  "/apps/mobile/src/",
  "/apps/desktop/src/",
  "/apps/hq/src/",
  "/packages/client-runtime/src/",
  "/packages/shared/src/",
] as const;
const TEST_FILE_PATTERN =
  /(?:^|\/)(?:__tests__\/|__fixtures__\/|testing\/|[^/]+\.(?:test|spec|bench)\.[cm]?[jt]sx?$)/u;

const ledger = loadExceptionLedger(RULE_NAME, globalThis.process.env[LEDGER_DIRECTORY_ENV]);

const coveredPath = (filename: string): string | undefined => {
  const normalized = `/${filename.replaceAll("\\", "/")}`;
  for (const marker of SCOPE_MARKERS) {
    const index = normalized.lastIndexOf(marker);
    if (index === -1) continue;
    const path = normalized.slice(index + 1);
    return TEST_FILE_PATTERN.test(path) ? undefined : path;
  }
  return undefined;
};

const NAME_CHARACTER = /[\w$]/u;
const WHITESPACE = /\s/u;

/** Source text with comments dropped and whitespace kept only where it separates two names. */
interface CompactText {
  readonly text: string;
  /** The source offset of each compact character. */
  readonly offsets: ReadonlyArray<number>;
}

/**
 * Compacts text so a formatter's rewrap neither hides a site nor breaks an entry: comments and
 * whitespace go, except one space between two name characters (`const x` stays two words).
 */
const compact = (
  text: string,
  skipped: ReadonlyArray<readonly [number, number]> = [],
): CompactText => {
  let out = "";
  const offsets: Array<number> = [];
  let pendingSpace = false;
  let skip = 0;
  for (let index = 0; index < text.length; index += 1) {
    while (skip < skipped.length && skipped[skip]![1] <= index) skip += 1;
    const range = skipped[skip];
    if ((range !== undefined && index >= range[0]) || WHITESPACE.test(text[index]!)) {
      pendingSpace = out.length > 0;
      continue;
    }
    const character = text[index]!;
    if (pendingSpace && NAME_CHARACTER.test(out.at(-1)!) && NAME_CHARACTER.test(character)) {
      out += " ";
      offsets.push(index - 1);
    }
    pendingSpace = false;
    out += character;
    offsets.push(index);
  }
  return { text: out, offsets };
};

/** Each occurrence of the token, bounded where the token itself begins or ends with a name. */
const occurrences = (text: string, token: string): ReadonlyArray<number> => {
  const found: Array<number> = [];
  const boundedStart = NAME_CHARACTER.test(token.at(0) ?? "");
  const boundedEnd = NAME_CHARACTER.test(token.at(-1) ?? "");
  for (let index = text.indexOf(token); index !== -1; index = text.indexOf(token, index + 1)) {
    const before = text[index - 1] ?? "";
    const after = text[index + token.length] ?? "";
    if (boundedStart && NAME_CHARACTER.test(before)) continue;
    if (boundedEnd && NAME_CHARACTER.test(after)) continue;
    found.push(index);
  }
  return found;
};

const COMPACT_TOKENS: ReadonlyMap<RetiredMechanism, string> = new Map(
  RETIRED_MECHANISMS.map((mechanism) => [mechanism, compact(mechanism.token).text]),
);

const summaryOf = (mechanism: RetiredMechanism): string =>
  `\`${mechanism.token}\` is retired (${mechanism.family}): ${mechanism.reason}.`;

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "A mechanism the client data-layer rewrite retires gains no new site; its ledger only shrinks.",
    },
  },
  create(context) {
    const path = coveredPath(context.filename);
    if (path === undefined) return {};

    /** Sanction behavior at its reviewed boundary, rather than banning its old name. */
    const sanctioned = (program: ESTree.Program, token: string): boolean => {
      const text = compactSyntax(context, program);
      const body = (name: string): string => {
        const fn = functionNamed(program, name);
        return fn === undefined ? "" : compactSyntax(context, fn);
      };
      const hasWriter = (value: string): boolean =>
        /(?:Atom\.make\(|create(?:Store|Environment\w*)?\(|useState\(|\.setState\(|\.subscribe\(|\.set\()/u.test(
          value,
        );
      switch (token) {
        case "useZeropsRegistry":
          if (path === "apps/web/src/zerops/useZeropsRegistry.ts") {
            const facade = body("useZeropsRegistry");
            return (
              facade.includes("useAtomValue(hqNavigationAtom)") &&
              facade.includes("registryFromHq(structure)") &&
              facade.includes("loading:true") &&
              !hasWriter(facade)
            );
          }
          return [...syntaxNodes(program)].some(
            (node) =>
              node.type === "ImportDeclaration" &&
              String(node.source.value).endsWith("/useZeropsRegistry") &&
              node.specifiers.some(
                (specifier) =>
                  specifier.type === "ImportSpecifier" &&
                  specifier.imported.type === "Identifier" &&
                  specifier.imported.name === "useZeropsRegistry",
              ),
          );
        case "bear(false)":
          // The old permission read has gone; dispatch and refusal live in hq-birth.
          return (
            path === "apps/web/src/components/zerops/ZeropsHqGate.tsx" &&
            text.includes('kind:"hq-birth"') &&
            text.includes("operations.submit(")
          );
        case "useZeropsOrganizationMembersRead":
          return (
            (path === "apps/web/src/zerops/useZeropsMateOwners.ts" &&
              body(token).includes("useProjection(organizationMembers,") &&
              body(token).includes('family:"organizationMembers"') &&
              !hasWriter(body(token))) ||
            (path === "apps/web/src/zerops/accountHq.ts" &&
              text.includes("findOfficialHq(members)") &&
              !/(?:isViewer|mayWrite|mine)(?::|=)/u.test(text))
          );
        case "ownersAndAdmins(":
          return (
            (path === "packages/client-runtime/src/zerops/hq/anchor.ts" &&
              body("ownersAndAdmins").includes("members.filter(") &&
              body("ownersAndAdmins").includes("!isTokenMember(member)") &&
              !hasWriter(body("ownersAndAdmins"))) ||
            (path === "apps/web/src/zerops/accountHq.ts" &&
              text.includes("findOfficialHq(members)") &&
              !/(?:isViewer|mayWrite|mine)(?::|=)/u.test(text))
          );
        case "settleToIdleAfter": {
          const display = body(token);
          return (
            path === "apps/web/src/zerops/useZeropsMateUpdate.ts" &&
            display.includes('state:{phase:"idle"}') &&
            !/(?:phase:["'](?:failed|updated|already-current)|settle\()/u.test(display) &&
            [...syntaxNodes(program)]
              .filter(
                (node) =>
                  node.type === "CallExpression" &&
                  node.callee.type === "Identifier" &&
                  node.callee.name === token,
              )
              .every((call) => {
                for (let parent = call.parent; parent !== null; parent = parent.parent) {
                  if (
                    parent.type !== "IfStatement" ||
                    call.start < parent.consequent.start ||
                    call.end > parent.consequent.end
                  )
                    continue;
                  const test = compactSyntax(context, parent.test);
                  if (
                    test === 'state.phase==="updated"' ||
                    test === 'state.phase==="already-current"||state.phase==="updated"'
                  )
                    return true;
                }
                return false;
              })
          );
        }
        case "serverConfigState":
          return (
            path === "packages/client-runtime/src/rpc/session.ts" &&
            text.includes("Ref.make(Option.none<ServerConfigReplayState>())") &&
            /PubSub\.sliding<BufferedServerConfigEvent>\(\d+\)/u.test(text) &&
            text.includes("buffered.revision>snapshot.value.revision") &&
            !/(?:Atom\.make|\.setState|localStorage|sessionStorage)/u.test(text)
          );
        case "await fetch(url, { signal: requestSignal })":
          return (
            path === "apps/web/src/openVsxThemes.ts" &&
            text.includes("newURL(OPEN_VSX_SEARCH_URL)") &&
            text.includes('url.searchParams.set("category","Themes")')
          );
        case "createWorkspaceFileImageAtomFamily(": {
          const prefetch = body("prefetchWithNativeImage");
          const family = body("createWorkspaceFileImageAtomFamily");
          return (
            path === "apps/mobile/src/features/files/workspace-file-image-cache.ts" &&
            prefetch.includes("Image.prefetch(uri)") &&
            family.includes("prefetch(key.uri)") &&
            family.includes("returnkey.uri;") &&
            !/(?:exists|mayWrite|permission|metadata):/u.test(family)
          );
        }
        default:
          return false;
      }
    };

    return {
      Program(program) {
        const comments = context.sourceCode
          .getAllComments()
          .map((comment) => [comment.start, comment.end] as const);
        const source = compact(context.sourceCode.text, comments);

        for (const [mechanism, token] of COMPACT_TOKENS) {
          if (sanctioned(program, mechanism.token)) continue;
          if (mechanism.paths !== undefined && !mechanism.paths.includes(path)) continue;
          for (const index of occurrences(source.text, token)) {
            const fingerprint = normalizeFingerprint(mechanism.token);
            const ledgered = ledger.has({ path, kind: KIND, fingerprint });
            if (ledgered && !shouldReportLedgered()) continue;
            context.report({
              loc: {
                start: context.sourceCode.getLocFromIndex(source.offsets[index]!),
                end: context.sourceCode.getLocFromIndex(
                  source.offsets[index + token.length - 1]! + 1,
                ),
              },
              message: formatFindingMessage({
                ruleName: RULE_NAME,
                summary: summaryOf(mechanism),
                kind: KIND,
                fingerprint,
                ledgered,
              }),
            });
          }
        }
      },
    };
  },
});
