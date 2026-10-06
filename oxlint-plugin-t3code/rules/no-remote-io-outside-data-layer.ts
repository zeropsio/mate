import { defineRule, type ESTree } from "@oxlint/plugins";
import * as Option from "effect/Option";

import {
  formatFindingMessage,
  loadExceptionLedger,
  normalizeFingerprint,
  shouldReportLedgered,
} from "../exceptions.ts";
import { getPropertyName, resolveVariable, unwrapExpression } from "../utils.ts";

/**
 * Remote I/O happens in the data layer alone: the client runtime's adapters reach Zerops, HQ and
 * the Mates, and everything else reads what they hold. In the web app, the mobile app and the rest
 * of the client runtime, a `fetch`, a socket, an event source, a raw request, a beacon, Effect's
 * HTTP client, a query library, a remote-query atom, and a Zerops or HQ client built or called
 * directly are reported. Tests and benchmarks are not sources.
 */
const RULE_NAME = "no-remote-io-outside-data-layer";
const LEDGER_DIRECTORY_ENV = "T3CODE_REMOTE_IO_LEDGER_DIRECTORY";
const SCOPE_MARKERS = [
  "/apps/web/src/",
  "/apps/mobile/src/",
  "/packages/client-runtime/src/",
] as const;
/**
 * The data layer's adapters, the one place remote I/O lives: the Zerops REST client, the HQ
 * client, the Zerops data runtime that drives them, and the Mate transports (RPC, connection,
 * authorization, relay) with the environment atoms built on them, and the new data layer's source
 * adapters and operation executors. A directory is listed only where every module in it is
 * transport; anything else in the client runtime — the data layer's store, reducer, projections,
 * operation kinds, receipts and coordinator included — is reported like the apps.
 */
const ADAPTER_PATHS = [
  "packages/client-runtime/src/data/adapters/",
  "packages/client-runtime/src/data/operations/executors/",
  "packages/client-runtime/src/zerops/api.ts",
  "packages/client-runtime/src/zerops/hq/client.ts",
  "packages/client-runtime/src/zerops/data/",
  "packages/client-runtime/src/rpc/",
  "packages/client-runtime/src/state/",
  "packages/client-runtime/src/connection/",
  "packages/client-runtime/src/authorization/",
  "packages/client-runtime/src/relay/",
] as const;
/** Modules that fetch or upload files, never source data; each one names its file. */
const FILE_TRANSFER_PATHS: ReadonlySet<string> = new Set([
  // Theme extensions and their manifests from Open VSX.
  "apps/web/src/openVsxThemes.ts",
  // The terminal's bundled wasm.
  "apps/web/src/terminal/ghostty/runtime.ts",
  // The bundled notification sounds.
  "apps/web/src/threadNotifications.ts",
  // A chat attachment uploaded with progress.
  "apps/web/src/lib/attachmentUploadQueue.ts",
  // The HQ core bundle shipped with the app.
  "apps/web/src/components/zerops/ZeropsHqUpdate.tsx",
]);
const TEST_FILE_PATTERN =
  /(?:^|\/)(?:__tests__\/|__fixtures__\/|testing\/|[^/]+\.(?:test|spec|bench)\.[cm]?[jt]sx?$)/u;

const ledger = loadExceptionLedger(RULE_NAME, globalThis.process.env[LEDGER_DIRECTORY_ENV]);

const coveredPath = (filename: string): string | undefined => {
  const normalized = `/${filename.replaceAll("\\", "/")}`;
  for (const marker of SCOPE_MARKERS) {
    const index = normalized.lastIndexOf(marker);
    if (index === -1) continue;
    const path = normalized.slice(index + 1);
    if (TEST_FILE_PATTERN.test(path)) return undefined;
    if (FILE_TRANSFER_PATHS.has(path)) return undefined;
    return ADAPTER_PATHS.some((adapter) => path.startsWith(adapter)) ? undefined : path;
  }
  return undefined;
};

const GLOBAL_OBJECTS: ReadonlySet<string> = new Set(["globalThis", "window", "self"]);

/** `name`, or `globalThis.name` / `window.name` / `self.name`: a global reached either way. */
const globalName = (node: unknown): string | undefined => {
  const expression = Option.getOrUndefined(unwrapExpression(node));
  if (expression?.type === "Identifier") return expression.name;
  if (expression?.type !== "MemberExpression" || expression.computed) return undefined;
  const object = Option.getOrUndefined(unwrapExpression(expression.object));
  return object?.type === "Identifier" && GLOBAL_OBJECTS.has(object.name)
    ? Option.getOrUndefined(getPropertyName(expression.property))
    : undefined;
};

/** The called name: `name(…)` or `receiver.name(…)`. */
const calleeName = (node: unknown): string | undefined => {
  const callee = Option.getOrUndefined(unwrapExpression(node));
  if (callee?.type === "Identifier") return callee.name;
  return callee?.type === "MemberExpression" && !callee.computed
    ? Option.getOrUndefined(getPropertyName(callee.property))
    : undefined;
};

/** A callee's text without optional chaining, the stable part of a finding's fingerprint. */
const headOf = (text: string): string => text.replaceAll("?.", ".").replace(/\s*\.\s*/gu, ".");

/** `navigator.sendBeacon`, a request the page cannot even await. */
const isBeacon = (node: unknown): boolean => {
  const callee = Option.getOrUndefined(unwrapExpression(node));
  return (
    callee?.type === "MemberExpression" &&
    Option.getOrUndefined(getPropertyName(callee.property)) === "sendBeacon" &&
    globalName(callee.object) === "navigator"
  );
};

/** Effect's HTTP client and sockets, and React Query: libraries whose only job is to reach a remote. */
const REMOTE_LIBRARY =
  /^(?:effect\/unstable\/(?:http|socket)(?:\/|$)|@tanstack\/(?:react-)?query)/u;
/** Effect Atom's reactivity module, whose RPC and HTTP API atoms query a remote. */
const REACTIVITY = /^effect\/unstable\/reactivity(?:\/|$)/u;
const REMOTE_ATOM_MODULES: ReadonlySet<string> = new Set(["AtomRpc", "AtomHttpApi"]);
const REMOTE_ATOM_PATH = /^effect\/unstable\/reactivity\/(?:AtomRpc|AtomHttpApi)$/u;

const specifierName = (name: ESTree.IdentifierName | ESTree.StringLiteral): string =>
  name.type === "Literal" ? String(name.value) : name.name;

/** The client runtime's remote atom constructors: each one reads, subscribes or commands a Mate. */
const REMOTE_ATOM_CONSTRUCTORS: ReadonlySet<string> = new Set([
  "createEnvironmentCommand",
  "createEnvironmentRpcCommand",
  "createEnvironmentRpcStreamCommand",
  "createEnvironmentQueryAtomFamily",
  "createEnvironmentRpcQueryAtomFamily",
  "createEnvironmentRpcSubscriptionAtomFamily",
  "createEnvironmentSubscriptionAtomFamily",
]);

/** The Zerops API client's remote verbs (`ZeropsApiClient`, `client-runtime/src/zerops/api.ts`). */
export const ZEROPS_CLIENT_VERBS = [
  "adoptSession",
  "buildAndDeployAppVersion",
  "createAppVersion",
  "createProject",
  "createProjectEnv",
  "createPublicHttpRouting",
  "deleteIntegrationToken",
  "deleteIntegrationTokenDelegation",
  "deleteProject",
  "deleteThrowaway",
  "enableSubdomainAccess",
  "exchangeWebSocketToken",
  "fetchProject",
  "fetchProjectLogAccess",
  "fetchUser",
  "hardenMate",
  "importDevelopmentContainer",
  "importProject",
  "importServicesIntoProject",
  "isZeropsMateEnabled",
  "isolateProjectEnvironment",
  "listAccessibleClientProjects",
  "listClientProjects",
  "listIntegrationTokenDelegations",
  "listIntegrationTokens",
  "listOrganizationMembers",
  "listProjectProcesses",
  "listProjectServices",
  "listPublicHttpRoutings",
  "listServiceVariableNames",
  "login",
  "logout",
  "mintIntegrationToken",
  "mintThrowaway",
  "readAccessibleClientProjects",
  "readIntegrationToken",
  "readProcessStatus",
  "readProjectBirthEnv",
  "readProjectCreation",
  "readProjectEnv",
  "regenerateIntegrationToken",
  "renewHeldSession",
  "register",
  "requestData",
  "restartService",
  "setIntegrationTokenProjects",
  "setProjectMemberRole",
  "startProject",
  "startService",
  "stopService",
  "syncPublicHttpRouting",
  "uploadAppVersionArchive",
  "verifyTotp",
  "writeMateFlag",
  "writeProject",
  "writeServiceSecret",
] as const;

/** The HQ client's remote verbs (`HqApi`, `client-runtime/src/zerops/hq/client.ts`). */
export const HQ_CLIENT_VERBS = [
  "structure",
  "streamStructure",
  "prepareProjectDeletion",
  "completeProjectDeletion",
  "mateKey",
  "updateMate",
  "renameApp",
  "deleteApp",
  "moveProject",
  "createMate",
  "recordClosedOff",
  "recheckKey",
  "createApp",
  "recordBirth",
  "holdPress",
  "endPress",
  "bindBirth",
  "attachProject",
  "keepDeployToken",
  "redeploy",
  "addService",
  "gitCredentials",
  "issueGitCredential",
  "revokeGitCredential",
  "repositorySource",
  "change",
  "changeComments",
  "commentOnChange",
  "mergeChange",
  "closeChange",
  "changeAttachment",
  "mateRecipe",
  "compare",
  "release",
  "rollback",
] as const;

const CLIENT_VERBS: ReadonlySet<string> = new Set([...ZEROPS_CLIENT_VERBS, ...HQ_CLIENT_VERBS]);

/**
 * A receiver that is a Zerops or HQ client by name: `client`, `hq.api`, `input.platform`,
 * `accountHqApi(…)`, `hqApi()`. A port, a provider's value or the data runtime's `commands` is not.
 */
const CLIENT_RECEIVER = /(?:api|hq|client|platform)$/iu;

/** The name a receiver goes by: its identifier, its last property, or the function that made it. */
const receiverName = (node: unknown): string | undefined => {
  const receiver = Option.getOrUndefined(unwrapExpression(node));
  return receiver?.type === "CallExpression" ? calleeName(receiver.callee) : calleeName(receiver);
};

/** `client.verb(…)` for a Zerops or HQ client verb, called on something that is that client. */
const isClientCall = (node: unknown): boolean => {
  const callee = Option.getOrUndefined(unwrapExpression(node));
  if (callee?.type !== "MemberExpression" || callee.computed) return false;
  const verb = Option.getOrUndefined(getPropertyName(callee.property));
  if (verb === undefined || !CLIENT_VERBS.has(verb)) return false;
  return CLIENT_RECEIVER.test(receiverName(callee.object) ?? "");
};

/** Factories that hand out an HQ client. */
const CLIENT_FACTORIES: ReadonlySet<string> = new Set(["makeHqApi"]);

/** Constructors that open a remote connection the moment they run, or build a client that does. */
const REMOTE_CONSTRUCTORS: ReadonlySet<string> = new Set([
  "WebSocket",
  "EventSource",
  "XMLHttpRequest",
  "ZeropsApiClient",
]);

/** A property, method or type member named by the identifier, rather than a value it reads. */
const isKeyName = (node: ESTree.Node): boolean => {
  const parent = node.parent;
  if (parent === null || !("key" in parent) || parent.key !== node) return false;
  if ("computed" in parent && parent.computed) return false;
  return !("shorthand" in parent && parent.shorthand);
};

/** Type positions: a name there is a type, never a value that reaches the network. */
const TYPE_CONTEXTS: ReadonlySet<string> = new Set([
  "TSTypeQuery",
  "TSTypeAnnotation",
  "TSTypeReference",
  "TSQualifiedName",
  "TSTypeLiteral",
  "TSInterfaceBody",
  "TSTypeAliasDeclaration",
]);

const inTypePosition = (node: ESTree.Node): boolean => {
  for (let current = node.parent; current !== null; current = current.parent) {
    if (TYPE_CONTEXTS.has(current.type)) return true;
  }
  return false;
};

/**
 * `fetch` read as a value rather than called: handed on, it reaches the network elsewhere. A
 * type that names it, or `typeof fetch` asking whether it exists, hands nothing on.
 */
const handsOnFetch = (node: ESTree.Node): boolean => {
  const parent = node.parent;
  if (parent?.type === "CallExpression" && parent.callee === node) return false;
  if (parent?.type === "UnaryExpression" && parent.operator === "typeof") return false;
  return !inTypePosition(node);
};

const ADAPTERS_OWN_IO =
  "Remote I/O belongs to the data layer: read the projection; adapters own I/O.";

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Remote I/O (fetch, sockets, HTTP clients, remote-query atoms, Zerops/HQ client calls) happens only in the data layer's adapters.",
    },
  },
  create(context) {
    const path = coveredPath(context.filename);
    if (path === undefined) return {};

    const report = (node: ESTree.Node, head: string) => {
      const kind = node.type;
      const fingerprint = normalizeFingerprint(head);
      const ledgered = ledger.has({ path, kind, fingerprint });
      if (ledgered && !shouldReportLedgered()) return;
      context.report({
        node,
        message: formatFindingMessage({
          ruleName: RULE_NAME,
          summary: ADAPTERS_OWN_IO,
          kind,
          fingerprint,
          ledgered,
        }),
      });
    };

    /** Shorthand properties can visit one identifier twice; a site reports once. */
    const reported = new Set<number>();

    return {
      CallExpression(node) {
        const head = headOf(context.sourceCode.getText(node.callee));
        if (globalName(node.callee) === "fetch" || isBeacon(node.callee)) return report(node, head);
        const name = calleeName(node.callee);
        if (name !== undefined && REMOTE_ATOM_CONSTRUCTORS.has(name)) return report(node, head);
        if (name !== undefined && CLIENT_FACTORIES.has(name)) return report(node, head);
        if (isClientCall(node.callee)) report(node, head);
      },
      ImportDeclaration(node) {
        if (node.importKind === "type") return;
        const source = String(node.source.value);
        const values = node.specifiers.filter(
          (specifier) => specifier.type !== "ImportSpecifier" || specifier.importKind !== "type",
        );
        if (values.length === 0) return;
        if (REMOTE_LIBRARY.test(source)) return report(node, source);
        if (!REACTIVITY.test(source)) return;
        const remoteAtoms = values.some(
          (specifier) =>
            specifier.type === "ImportSpecifier" &&
            REMOTE_ATOM_MODULES.has(specifierName(specifier.imported)),
        );
        if (remoteAtoms || REMOTE_ATOM_PATH.test(source)) report(node, source);
      },
      Identifier(node) {
        if (node.name !== "fetch" || !handsOnFetch(node)) return;
        const parent = node.parent;
        if (parent?.type === "MemberExpression" && parent.property === node) return;
        if (isKeyName(node)) return;
        if (parent?.type.startsWith("Import")) return;
        if (resolveVariable(context, node)?.defs.length) return;
        if (reported.has(node.start)) return;
        reported.add(node.start);
        report(node, "fetch");
      },
      MemberExpression(node) {
        if (globalName(node) !== "fetch" || node.object.type !== "Identifier") return;
        if (handsOnFetch(node)) report(node, headOf(context.sourceCode.getText(node)));
      },
      NewExpression(node) {
        const name = globalName(node.callee);
        if (name !== undefined && REMOTE_CONSTRUCTORS.has(name)) {
          report(node, `new ${context.sourceCode.getText(node.callee)}`);
        }
      },
    };
  },
});
