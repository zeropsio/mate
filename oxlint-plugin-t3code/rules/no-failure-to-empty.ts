// @effect-diagnostics nodeBuiltinImport:off -- Oxlint resolves import provenance synchronously.
import { defineRule, type Context, type ESTree } from "@oxlint/plugins";
import * as Option from "effect/Option";
import * as NodePath from "node:path";

import {
  formatFindingMessage,
  loadExceptionLedger,
  normalizeFingerprint,
  shouldReportLedgered,
} from "../exceptions.ts";
import { compactSyntax, enclosingFunction, syntaxNodes } from "./boundaries.ts";
import { getPropertyName, resolveVariable, unwrapExpression } from "../utils.ts";

const RULE_NAME = "no-failure-to-empty";
const LEDGER_DIRECTORY_ENV = "T3CODE_FAILURE_TO_EMPTY_LEDGER_DIRECTORY";
const GUARDED_ROOTS = [
  "apps/web/src/",
  "packages/client-runtime/src/data/",
  "packages/client-runtime/src/zerops/",
] as const;
const EMPTY_CONSTANT_PATTERN = /^(?:EMPTY_|NO_|NONE(?:_|$))/u;
const TEST_FILE_PATTERN = /(?:^|\/)(?:__tests__\/|[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$)/u;

const ledgerDirectory = globalThis.process.env[LEDGER_DIRECTORY_ENV];
const ledger = loadExceptionLedger(RULE_NAME, ledgerDirectory);

const sourcePath = (filename: string): string | undefined => {
  const normalized = `/${filename.replaceAll("\\", "/")}`;
  for (const root of GUARDED_ROOTS) {
    const markerIndex = normalized.lastIndexOf(`/${root}`);
    if (markerIndex !== -1) return normalized.slice(markerIndex + 1);
  }
  return undefined;
};

/** `[]`, `undefined` (`void …` included) or `null`: the empties a failure is turned into. */
const isEmptyValue = (node: unknown): boolean => {
  const expression = unwrapExpression(node);
  if (Option.isNone(expression)) return false;
  const value = expression.value;
  if (value.type === "ArrayExpression") return value.elements.length === 0;
  if (value.type === "Identifier") return value.name === "undefined";
  if (value.type === "UnaryExpression") return value.operator === "void";
  return value.type === "Literal" && value.value === null && !("regex" in value);
};

/**
 * Whether a statement list can end in an empty: its last statement returns one, returns nothing,
 * or lets control run off the end (`{}`, `{ log(cause); }`, an `if` a branch of which does).
 * A `try`, `switch` or loop at the end is not followed.
 */
const endsEmpty = (statements: ReadonlyArray<ESTree.Statement>): boolean => {
  const last = statements.at(-1);
  if (last === undefined) return true;
  switch (last.type) {
    case "ReturnStatement":
      return last.argument === null || isEmptyValue(last.argument);
    case "ThrowStatement":
    case "TryStatement":
    case "SwitchStatement":
    case "ForStatement":
    case "ForInStatement":
    case "ForOfStatement":
    case "WhileStatement":
    case "DoWhileStatement":
    case "LabeledStatement":
      return false;
    case "BlockStatement":
      return endsEmpty(last.body);
    case "IfStatement":
      return endsEmpty([last.consequent]) || last.alternate === null || endsEmpty([last.alternate]);
    default:
      return true;
  }
};

/**
 * A handler that answers an empty: `() => []`, `() => void 0`, or a block that ends in one
 * (`(cause) => { log(cause); return null; }`, `(cause) => { log(cause); }`).
 */
const answersEmpty = (node: unknown): boolean => {
  const handler = unwrapExpression(node);
  if (Option.isNone(handler)) return false;
  const fn = handler.value;
  if (fn.type !== "ArrowFunctionExpression" && fn.type !== "FunctionExpression") return false;
  const body = fn.body;
  if (body === null || body === undefined) return false;
  return body.type === "BlockStatement" ? endsEmpty(body.body) : isEmptyValue(body);
};

/** The receiver of `receiver.method(…)`, when `node` is that call. */
const methodReceiver = (node: unknown, method: string): ESTree.Node | undefined => {
  const call = Option.getOrUndefined(unwrapExpression(node));
  if (call?.type !== "CallExpression") return undefined;
  const callee = Option.getOrUndefined(unwrapExpression(call.callee));
  return callee?.type === "MemberExpression" &&
    !callee.computed &&
    Option.getOrUndefined(getPropertyName(callee.property)) === method
    ? callee.object
    : undefined;
};

/**
 * `p.then(onFulfilled)` whose handler already answers an empty: a catch after it turns no value
 * into an empty, since the chain carries none (`.then(() => { refresh(); }).catch(…)`).
 */
const answersEmptyOnSuccess = (node: ESTree.Node): boolean => {
  const call = Option.getOrUndefined(unwrapExpression(node));
  return (
    call?.type === "CallExpression" &&
    methodReceiver(call, "then") !== undefined &&
    answersEmpty(call.arguments[0])
  );
};

const EMPTY_COLLECTIONS = new Set(["Map", "Set"]);

/** `[]`, `{}`, `new Map()` or `new Set()` (an empty array argument included): an empty literal. */
const isEmptyLiteral = (node: unknown): boolean => {
  const expression = Option.getOrUndefined(unwrapExpression(node));
  if (expression?.type === "TSSatisfiesExpression") return isEmptyLiteral(expression.expression);
  if (expression?.type === "ArrayExpression") return expression.elements.length === 0;
  if (expression?.type === "ObjectExpression") return expression.properties.length === 0;
  if (expression?.type !== "NewExpression") return false;
  const callee = Option.getOrUndefined(unwrapExpression(expression.callee));
  if (callee?.type !== "Identifier" || !EMPTY_COLLECTIONS.has(callee.name)) return false;
  const [entries, ...rest] = expression.arguments;
  return rest.length === 0 && (entries === undefined || isEmptyLiteral(entries));
};

/**
 * An identifier that names an empty constant. A binding this module declares is judged by what it
 * is bound to: a `const` whose initializer is an empty literal or another empty constant. Any other
 * binding (an import, a global) is judged by its name: `EMPTY_…`, `NO_…`, `NONE` or `NONE_…`.
 */
const isEmptyConstant = (context: Context, node: ESTree.Node, seen: Set<ESTree.Node>): boolean => {
  if (node.type !== "Identifier" || seen.has(node)) return false;
  seen.add(node);
  const [definition, ...others] = resolveVariable(context, node)?.defs ?? [];
  if (definition === undefined || definition.type === "ImportBinding") {
    return EMPTY_CONSTANT_PATTERN.test(node.name);
  }
  if (
    others.length > 0 ||
    definition.type !== "Variable" ||
    definition.node.type !== "VariableDeclarator" ||
    definition.parent?.type !== "VariableDeclaration" ||
    definition.parent.kind !== "const"
  ) {
    return false;
  }
  return isEmptyValueOrConstant(context, definition.node.init, seen);
};

const isEmptyValueOrConstant = (
  context: Context,
  node: unknown,
  seen: Set<ESTree.Node>,
): boolean => {
  if (isEmptyLiteral(node)) return true;
  const expression = Option.getOrUndefined(unwrapExpression(node));
  return expression !== undefined && isEmptyConstant(context, expression, seen);
};

/** An empty literal or an empty constant: the empties a store read is defaulted to. */
const isEmptyDefault = (context: Context, node: unknown): boolean =>
  isEmptyValueOrConstant(context, node, new Set());

/** Canonical origin, independent of local names, namespace syntax and the public data barrel. */
const canonicalImport = (source: string, name: string): { source: string; name: string } => {
  let module = source
    .replaceAll("\\", "/")
    .replace(/\.[cm]?[jt]sx?$/u, "")
    .replace(/\/index$/u, "");
  if (module.startsWith("@t3tools/client-runtime/"))
    module = module.replace("@t3tools/client-runtime/", "packages/client-runtime/src/");
  for (const root of ["apps/web/src/", "packages/client-runtime/src/"]) {
    const at = module.lastIndexOf(`/${root}`);
    if (at !== -1) module = module.slice(at + 1);
  }
  // These are the store exports of the public barrel; unexported symbols do not gain provenance.
  if (
    module === "packages/client-runtime/src/data" &&
    ["Projection", "AccountStore", "makeAccountStore", "readsOfState"].includes(name)
  )
    module += "/store";
  if (module === "effect/reactivity" && name === "AsyncResult")
    return { source: "effect/reactivity/AsyncResult", name: "*" };
  return { source: module, name };
};
const imported = (
  context: Context,
  node: unknown,
  seen = new Set<ESTree.Node>(),
): { source: string; name: string } | undefined => {
  const value = Option.getOrUndefined(unwrapExpression(node));
  if (value === undefined || seen.has(value)) return undefined;
  seen.add(value);
  if (value.type === "MemberExpression" || value.type === "TSQualifiedName") {
    const owner = value.type === "MemberExpression" ? value.object : value.left;
    const member = value.type === "MemberExpression" ? value.property : value.right;
    const namespace = imported(context, owner, seen);
    const name = Option.getOrUndefined(getPropertyName(member));
    return namespace?.name === "*" && name !== undefined
      ? canonicalImport(namespace.source, name)
      : undefined;
  }
  const definition = resolveVariable(context, value)?.defs[0];
  if (definition?.type !== "ImportBinding" || definition.parent?.type !== "ImportDeclaration") {
    const init = localInitializer(context, value);
    return init === undefined ? undefined : imported(context, init, seen);
  }
  const source = definition.parent.source.value;
  if (typeof source !== "string") return undefined;
  const specifier = definition.node;
  const name =
    specifier.type === "ImportSpecifier"
      ? Option.getOrUndefined(getPropertyName(specifier.imported))
      : specifier.type === "ImportNamespaceSpecifier"
        ? "*"
        : "default";
  const module = source.startsWith("~/")
    ? `apps/web/src/${source.slice(2)}`
    : source.startsWith(".")
      ? NodePath.resolve(NodePath.dirname(context.filename), source)
      : source;
  return name === undefined ? undefined : canonicalImport(module, name);
};

/** Follow only immutable local bindings; names and mutable assignments do not prove provenance. */
const localInitializer = (context: Context, node: unknown): ESTree.Node | undefined => {
  const [definition, ...others] = resolveVariable(context, node)?.defs ?? [];
  return others.length === 0 &&
    definition?.type === "Variable" &&
    definition.node.type === "VariableDeclarator" &&
    definition.node.id.type === "Identifier" &&
    definition.parent?.type === "VariableDeclaration" &&
    definition.parent.kind === "const"
    ? Option.getOrUndefined(unwrapExpression(definition.node.init))
    : undefined;
};
const localOrigin = (
  context: Context,
  node: unknown,
  seen = new Set<ESTree.Node>(),
): ESTree.Node | undefined => {
  const value = Option.getOrUndefined(unwrapExpression(node));
  if (value === undefined || seen.has(value)) return undefined;
  seen.add(value);
  const init = value.type === "Identifier" ? localInitializer(context, value) : undefined;
  return init === undefined ? value : localOrigin(context, init, seen);
};

/** Every type matcher follows the same immutable binding chain, retaining intermediate annotations. */
function* localDefinitions(context: Context, node: unknown) {
  let value = Option.getOrUndefined(unwrapExpression(node));
  const seen = new Set<ESTree.Node>();
  while (value !== undefined && !seen.has(value)) {
    seen.add(value);
    yield* resolveVariable(context, value)?.defs ?? [];
    const init = localInitializer(context, value);
    if (init?.type !== "Identifier") return;
    value = init;
  }
}

const hasReadType = (context: Context, node: unknown, names: ReadonlySet<string>): boolean => {
  for (const definition of localDefinitions(context, node)) {
    const id =
      definition.type === "Variable" && definition.node.type === "VariableDeclarator"
        ? definition.node.id
        : definition.name;
    const annotation = id.type === "Identifier" ? id.typeAnnotation?.typeAnnotation : undefined;
    if (annotation?.type !== "TSTypeReference") {
      // Projection.derive's first parameter is contextually ProjectionReads.
      if (names.has("ProjectionReads") && definition.type === "Parameter") {
        const fn = definition.node;
        const property = fn.parent;
        if (
          (fn.type === "ArrowFunctionExpression" || fn.type === "FunctionExpression") &&
          fn.params[0] === id &&
          property?.type === "Property" &&
          Option.getOrUndefined(getPropertyName(property.key)) === "derive"
        ) {
          const declaration = Option.getOrUndefined(unwrapExpression(property.parent?.parent));
          if (declaration?.type === "VariableDeclarator" && declaration.id.type === "Identifier") {
            const identifier = Option.getOrUndefined(unwrapExpression(declaration.id));
            const type =
              identifier?.type === "Identifier"
                ? identifier.typeAnnotation?.typeAnnotation
                : undefined;
            if (type?.type === "TSTypeReference") {
              const binding = imported(context, type.typeName);
              if (
                binding?.name === "Projection" &&
                binding.source === "packages/client-runtime/src/data/store"
              )
                return true;
            }
          }
        }
      }
      continue;
    }
    const binding = imported(context, annotation.typeName);
    if (
      binding !== undefined &&
      names.has(binding.name) &&
      (binding.source === "packages/client-runtime/src/data/store" ||
        binding.source === "packages/client-runtime/src/data/model")
    )
      return true;
  }
  return false;
};
const PUBLIC_TYPES = new Set(["PublicRead"]);
const PROJECTION_TYPES = new Set(["ProjectionReads"]);
const ACCOUNT_TYPES = new Set(["AccountData"]);
const READ_IMPORTS: Readonly<Record<string, ReadonlyArray<string>>> = {
  "apps/web/src/zerops/ZeropsAccountData": ["useProjection"],
  "apps/web/src/state/queries": ["usePaginatedBranches"],
  "apps/web/src/state/query": ["useEnvironmentQuery"],
  "apps/web/src/hooks/useSettings": ["useEnvironmentSettings", "usePrimarySettings"],
  "apps/web/src/zerops/crew/useCrew": ["useCrew", "useMateCrew"],
  "apps/web/src/zerops/useZeropsFeeds": [
    "useEnvironmentTopology",
    "useZeropsTopology",
    "useZeropsLifecycle",
    "useZeropsAgentAuth",
    "useZeropsBrowserStream",
    "useZeropsDataConsole",
  ],
  "apps/web/src/zerops/useZeropsCandidates": [
    "useHeldZeropsCandidates",
    "useZeropsCandidates",
    "useTakenBotNames",
  ],
  "apps/web/src/zerops/useZeropsMates": ["useZeropsMateDirectory", "useZeropsMate", "useKnownMate"],
  "apps/web/src/zerops/useZeropsGitRemoteProbe": ["useGitRemoteReads"],
  "apps/web/src/components/files/projectFilesQueryState": [
    "useProjectEntriesQuery",
    "useProjectFilePickerQuery",
    "useProjectFileQuery",
  ],
  "apps/web/src/lib/resourceTelemetryState": [
    "useResourceTelemetry",
    "useResourceTelemetryHistory",
  ],
  "apps/web/src/lib/checkpointDiffState": ["useCheckpointDiff"],
  "apps/web/src/zerops/useProjectTopology": ["useProjectTopology"],
  "apps/web/src/zerops/useZeropsDataMentions": ["useZeropsDataMentions"],
  "apps/web/src/zerops/projectFlows": [
    "useProjectFlows",
    "useCompactProjectFlows",
    "useAppsChanges",
    "useMateNames",
  ],
};
const isStoreHookCall = (context: Context, node: ESTree.Node): boolean => {
  if (node.type !== "CallExpression") return false;
  const binding = imported(context, node.callee);
  if (binding === undefined) return false;
  if (binding.source === "@effect/atom-react") return binding.name === "useAtomValue";
  return READ_IMPORTS[binding.source]?.includes(binding.name) === true;
};

/** Follow local aliases/destructuring, stopping at actual read calls rather than hook spelling. */
const isStoreRead = (context: Context, node: unknown, seen: Set<ESTree.Node>): boolean => {
  const value = Option.getOrUndefined(unwrapExpression(node));
  if (value === undefined || seen.has(value)) return false;
  seen.add(value);
  if (isStoreHookCall(context, value)) return true;
  if (value.type === "MemberExpression") return isStoreRead(context, value.object, seen);
  if (value.type === "CallExpression") return isStoreRead(context, value.callee, seen);
  if (value.type !== "Identifier") return false;
  const [definition, ...others] = resolveVariable(context, value)?.defs ?? [];
  return (
    others.length === 0 &&
    definition?.type === "Variable" &&
    definition.node.type === "VariableDeclarator" &&
    isStoreRead(context, definition.node.init, seen)
  );
};

/** Imported factories produce ProjectionReads; an arbitrary object with fact() does not. */
const isProjectionReads = (context: Context, node: unknown): boolean => {
  if (hasReadType(context, node, PROJECTION_TYPES)) return true;
  const origin = localOrigin(context, node);
  if (origin?.type !== "CallExpression") return false;
  const factory = imported(context, origin.callee);
  return (
    factory !== undefined &&
    factory.source === "packages/client-runtime/src/data/store" &&
    (factory.name === "readsOfState" || factory.name === "readsOf")
  );
};

/** PublicRead is a fact conversion or a ProjectionReads.fact result, never arbitrary project output. */
const isPublicRead = (context: Context, node: unknown, seen = new Set<ESTree.Node>()): boolean => {
  const value = Option.getOrUndefined(unwrapExpression(node));
  if (value === undefined || seen.has(value)) return false;
  seen.add(value);
  if (hasReadType(context, value, PUBLIC_TYPES)) return true;
  if (value.type === "Identifier") {
    const definition = resolveVariable(context, value)?.defs[0];
    return (
      definition?.type === "Variable" &&
      definition.node.type === "VariableDeclarator" &&
      definition.node.id.type === "Identifier" &&
      isPublicRead(context, definition.node.init, seen)
    );
  }
  if (value.type !== "CallExpression") return false;
  const binding = imported(context, value.callee);
  if (binding?.name === "publicRead" && binding.source === "packages/client-runtime/src/data/store")
    return true;
  const receiver = methodReceiver(value, "fact");
  if (receiver !== undefined && isProjectionReads(context, receiver)) return true;
  // Reading an AccountData.fact atom through React preserves its PublicRead discriminant.
  if (binding?.source === "@effect/atom-react" && binding.name === "useAtomValue") {
    const atom = localOrigin(context, value.arguments[0]);
    const account = methodReceiver(atom, "fact");
    return account !== undefined && hasReadType(context, account, ACCOUNT_TYPES);
  }
  return false;
};

const hasHeldType = (context: Context, node: ESTree.Node, property: string): boolean => {
  for (const definition of localDefinitions(context, node)) {
    const id =
      definition.type === "Variable" && definition.node.type === "VariableDeclarator"
        ? definition.node.id
        : definition.name;
    const type = id.type === "Identifier" ? id.typeAnnotation?.typeAnnotation : undefined;
    if (type?.type !== "TSTypeReference") continue;
    const binding = imported(context, type.typeName);
    if (binding === undefined) continue;
    if (
      property === "state"
        ? binding.source === "packages/client-runtime/src/zerops/knowledge" &&
          binding.name === "Known"
        : (binding.source === "packages/client-runtime/src/state/runtime" &&
            binding.name === "AtomCommandResult") ||
          (binding.source === "effect/reactivity/AsyncResult" && binding.name === "AsyncResult")
    )
      return true;
  }
  return false;
};

/** The property a Known's or an AsyncResult's state is in, and the state that holds a value. */
const HELD_STATES = new Map([
  ["state", "known"],
  ["kind", "known"],
  ["_tag", "Success"],
]);
const EQUALITY_OPERATORS = new Set(["===", "==", "!==", "!="]);

/** An expression's source as a subject, so `read?.value` and `read.value` name one subject. */
const subjectText = (context: Context, node: ESTree.Node): string =>
  context.sourceCode.text.slice(node.start, node.end).replaceAll("?.", ".").replace(/\s+/gu, "");

interface HeldCheck {
  /** The Known or AsyncResult the test checks. */
  readonly subject: string;
  /** Whether the conditional's consequent is the branch that holds its value. */
  readonly heldInConsequent: boolean;
}

/**
 * A test that checks whether a Known holds its value (`read.state === "known"`, the literal on
 * either side, `!==` inverted) or an AsyncResult does (`result._tag === "Success"`,
 * `AsyncResult.isSuccess(result)`), negated with `!` or not.
 */
const heldCheck = (context: Context, node: unknown): HeldCheck | undefined => {
  const test = Option.getOrUndefined(unwrapExpression(node));
  if (test?.type === "UnaryExpression" && test.operator === "!") {
    const inner = heldCheck(context, test.argument);
    return inner === undefined
      ? undefined
      : { ...inner, heldInConsequent: !inner.heldInConsequent };
  }
  if (test?.type === "CallExpression") {
    const guard = imported(context, test.callee);
    const subject = Option.getOrUndefined(unwrapExpression(test.arguments[0]));
    return guard?.source === "effect/reactivity/AsyncResult" &&
      guard.name === "isSuccess" &&
      subject !== undefined
      ? { subject: subjectText(context, subject), heldInConsequent: true }
      : undefined;
  }
  if (test?.type !== "BinaryExpression" || !EQUALITY_OPERATORS.has(test.operator)) return undefined;
  for (const [stateSide, literalSide] of [
    [test.left, test.right],
    [test.right, test.left],
  ] as const) {
    const state = Option.getOrUndefined(unwrapExpression(stateSide));
    const literal = Option.getOrUndefined(unwrapExpression(literalSide));
    if (state?.type !== "MemberExpression" || state.computed || literal?.type !== "Literal") {
      continue;
    }
    const property = Option.getOrUndefined(getPropertyName(state.property));
    const held = property === undefined ? undefined : HELD_STATES.get(property);
    if (held === undefined || literal.value !== held) continue;
    const subject = Option.getOrUndefined(unwrapExpression(state.object));
    if (subject === undefined) return undefined;
    if (
      property === "kind"
        ? !isPublicRead(context, subject)
        : !isStoreRead(context, subject, new Set()) &&
          !hasHeldType(context, subject, property ?? "")
    )
      continue;
    return {
      subject: subjectText(context, subject),
      heldInConsequent: test.operator === "===" || test.operator === "==",
    };
  }
  return undefined;
};

/** Whether `node` reads `<subject>.value` anywhere inside it, JSX included. */
const readsValueOf = (context: Context, node: unknown, subject: string): boolean => {
  if (typeof node !== "object" || node === null) return false;
  if (Array.isArray(node)) return node.some((child) => readsValueOf(context, child, subject));
  if (!("type" in node)) return false;
  const current = node as ESTree.Node;
  if (
    current.type === "MemberExpression" &&
    !current.computed &&
    Option.getOrUndefined(getPropertyName(current.property)) === "value"
  ) {
    const object = Option.getOrUndefined(unwrapExpression(current.object));
    if (object !== undefined && subjectText(context, object) === subject) return true;
  }
  return Object.entries(current).some(
    ([key, child]) => key !== "parent" && readsValueOf(context, child, subject),
  );
};

const TRANSPARENT_PARENTS = new Set([
  "AwaitExpression",
  "ChainExpression",
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
]);

/** `p.finally(…)` around `p`: it settles with `p`'s value. */
const finallyCallOn = (node: ESTree.Node): ESTree.Node | undefined => {
  const member = node.parent;
  if (
    member?.type !== "MemberExpression" ||
    member.object !== node ||
    member.computed ||
    Option.getOrUndefined(getPropertyName(member.property)) !== "finally"
  ) {
    return undefined;
  }
  const call = member.parent;
  return call?.type === "CallExpression" && call.callee === member ? call : undefined;
};

/**
 * A value nobody reads (`p.catch(…);`, `await p.catch(…);`, `void p.catch(…)`, also after a
 * `.finally(…)`) holds no empty.
 */
const isDiscarded = (node: ESTree.Node): boolean => {
  let current: ESTree.Node = node;
  for (;;) {
    if (current.parent !== null && TRANSPARENT_PARENTS.has(current.parent.type)) {
      current = current.parent;
      continue;
    }
    const settled = finallyCallOn(current);
    if (settled === undefined) break;
    current = settled;
  }
  const parent = current.parent;
  return (
    parent?.type === "ExpressionStatement" ||
    (parent?.type === "UnaryExpression" && parent.operator === "void")
  );
};

/** Only an explicitly void promise can lose no read/receipt value in a retained queue. */
const isUndefinedValue = (node: unknown): boolean => {
  const value = Option.getOrUndefined(unwrapExpression(node));
  return (
    (value?.type === "Identifier" && value.name === "undefined") ||
    (value?.type === "UnaryExpression" && value.operator === "void")
  );
};
const isVoidPromise = (context: Context, node: unknown): boolean => {
  const value = Option.getOrUndefined(unwrapExpression(node));
  if (value === undefined) return false;
  const definition = resolveVariable(context, value)?.defs[0];
  const id =
    definition?.type === "Variable" && definition.node.type === "VariableDeclarator"
      ? definition.node.id
      : definition?.name;
  const type = id?.type === "Identifier" ? id.typeAnnotation?.typeAnnotation : undefined;
  return (
    type?.type === "TSTypeReference" &&
    type.typeName.type === "Identifier" &&
    type.typeName.name === "Promise" &&
    type.typeArguments?.params.length === 1 &&
    type.typeArguments.params[0]?.type === "TSVoidKeyword"
  );
};

/** A literal query view may default its collection while carrying that query's error and pending. */
const isStatusBearingDefault = (context: Context, node: ESTree.LogicalExpression): boolean => {
  const field = node.parent;
  const view = field?.parent;
  if (field?.type !== "Property" || field.value !== node || view?.type !== "ObjectExpression")
    return false;
  if (view.properties.some((property) => property.type !== "Property" || property.computed))
    return false;
  if (
    !(view.parent?.type === "ReturnStatement" && view.parent.argument === view) &&
    !(view.parent?.type === "ArrowFunctionExpression" && view.parent.body === view)
  )
    return false;
  let subject = Option.getOrUndefined(unwrapExpression(node.left));
  while (subject?.type === "MemberExpression")
    subject = Option.getOrUndefined(unwrapExpression(subject.object));
  if (subject?.type !== "Identifier") return false;
  const binding = resolveVariable(context, subject);
  if (binding === undefined) return false;
  return ["error", "isPending"].every(
    (name) =>
      view.properties.filter(
        (property) =>
          property.type === "Property" &&
          Option.getOrUndefined(getPropertyName(property.key)) === name,
      ).length === 1 &&
      view.properties.some((property) => {
        if (
          property.type !== "Property" ||
          property.computed ||
          Option.getOrUndefined(getPropertyName(property.key)) !== name
        )
          return false;
        const value = Option.getOrUndefined(unwrapExpression(property.value));
        return (
          value?.type === "MemberExpression" &&
          !value.computed &&
          Option.getOrUndefined(getPropertyName(value.property)) === name &&
          resolveVariable(context, value.object) === binding
        );
      }),
  );
};

/** Presence of a reader's payload is affirmative evidence for its optional fields. */
const optionalGuard = (context: Context, test: unknown): HeldCheck | undefined => {
  const held = heldCheck(context, test);
  if (held !== undefined) return { ...held, subject: `${held.subject}.value` };
  const value = Option.getOrUndefined(unwrapExpression(test));
  if (value?.type !== "BinaryExpression" || !EQUALITY_OPERATORS.has(value.operator))
    return undefined;
  for (const [subjectSide, nullSide] of [
    [value.left, value.right],
    [value.right, value.left],
  ] as const) {
    const literal = Option.getOrUndefined(unwrapExpression(nullSide));
    const subject = Option.getOrUndefined(unwrapExpression(subjectSide));
    if (
      literal?.type === "Literal" &&
      literal.value === null &&
      subject !== undefined &&
      isStoreRead(context, subject, new Set())
    )
      return {
        subject: subjectText(context, subject),
        heldInConsequent: value.operator === "!==" || value.operator === "!=",
      };
  }
  return undefined;
};

/** A default within this subject's known branch fills an optional field, never an unread fact. */
const isGuardedFieldDefault = (context: Context, node: ESTree.LogicalExpression): boolean => {
  for (
    let ancestor: ESTree.Node | null = node.parent;
    ancestor !== null;
    ancestor = ancestor.parent
  ) {
    if (
      ancestor.type === "ArrowFunctionExpression" ||
      ancestor.type === "FunctionExpression" ||
      ancestor.type === "FunctionDeclaration"
    )
      break;
    if (ancestor.type !== "ConditionalExpression") continue;
    const check = optionalGuard(context, ancestor.test);
    if (check === undefined) continue;
    const held = check.heldInConsequent ? ancestor.consequent : ancestor.alternate;
    if (node.start < held.start || node.end > held.end) continue;
    if (
      [...syntaxNodes(node.left)].some(
        (part) =>
          part.type === "MemberExpression" && subjectText(context, part.object) === check.subject,
      )
    )
      return true;
  }
  return false;
};

/**
 * Web and shared Zerops/data reads cannot turn unread, withheld or failed facts into empties.
 * Imported read bindings (aliases and local destructuring included) qualify ?? defaults.
 * PublicRead.kind requires a publicRead conversion, imported read factory, ProjectionReads.fact or AccountData.fact atom;
 * project output is arbitrary. Legacy Known/command results require their imported type or a read
 * binding; isSuccess requires Effect's imported AsyncResult. Imported EMPTY_/NO_/NONE names remain
 * a heuristic; local constants are judged by their initializers. PublicRead carries access/evidence
 * state, not transport failure; the guard cannot prove stream coverage or freshness.
 * Discarded catches, success-void chains, typed void queues and exact status policies are permitted.
 * Deferred: if/switch, ||, Effect recovery, setter catches and cross-module value flow. Mobile is
 * excluded. Every remaining occurrence is reviewed in the classified multiset ledger.
 */
export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Reject a failed or unread remote fact turned into an empty value; a failure is not a negative.",
    },
  },
  create(context) {
    const path = sourcePath(context.filename);
    if (path === undefined || TEST_FILE_PATTERN.test(path)) return {};

    const report = (node: ESTree.Node, summary: string) => {
      const kind = node.type;
      const fingerprint = normalizeFingerprint(context.sourceCode.text.slice(node.start, node.end));
      const ledgered = ledger.has({ path, kind, fingerprint });
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

    return {
      CallExpression(node) {
        const receiver = methodReceiver(node, "catch");
        if (receiver === undefined || !answersEmpty(node.arguments[0])) return;
        if (answersEmptyOnSuccess(receiver) || isDiscarded(node)) return;
        const handler = Option.getOrUndefined(unwrapExpression(node.arguments[0]));
        if (
          isVoidPromise(context, receiver) &&
          handler !== undefined &&
          (handler.type === "ArrowFunctionExpression" || handler.type === "FunctionExpression") &&
          handler.body !== null &&
          [...syntaxNodes(handler.body)].every(
            (part) =>
              part.type !== "ReturnStatement" ||
              enclosingFunction(part) !== handler ||
              part.argument === null ||
              isUndefinedValue(part.argument),
          ) &&
          (handler.body.type === "BlockStatement" || isUndefinedValue(handler.body))
        )
          return;
        report(
          node,
          "A failed read caught into an empty reads as a negative. Keep the failure: hold the value as Known and let the view say it could not read it.",
        );
      },
      ConditionalExpression(node) {
        const fn = enclosingFunction(node);
        const expression = compactSyntax(context, node);
        // A failed settled command focuses no terminal; its failure is reported by the caller.
        if (
          path === "packages/client-runtime/src/zerops/agentLogin.ts" &&
          fn?.type === "FunctionDeclaration" &&
          fn.id?.name === "agentLoginTerminalToFocus" &&
          expression === 'result._tag==="Success"?result.value.terminalId:undefined' &&
          compactSyntax(context, fn).includes(
            "AtomCommandResult<ZeropsAgentLoginStartResult,unknown>",
          )
        )
          return;
        // Optional composition supplies no phase. The separate build read remains unobservable.
        if (
          path === "packages/client-runtime/src/zerops/model/deriveThreadModel.ts" &&
          fn?.type === "FunctionDeclaration" &&
          fn.id?.name === "deriveZeropsThreadModel" &&
          expression === 'lifecycle?.state==="known"?lifecycle.value.envelope:undefined' &&
          compactSyntax(context, fn).includes("builds:input.builds??UNOBSERVABLE")
        )
          return;
        const check = heldCheck(context, node.test);
        if (check === undefined) return;
        const [held, otherwise] = check.heldInConsequent
          ? [node.consequent, node.alternate]
          : [node.alternate, node.consequent];
        if (!isEmptyValue(otherwise) && !isEmptyDefault(context, otherwise)) return;
        if (!readsValueOf(context, held, check.subject)) return;
        report(
          node,
          "A Known or a result that holds no value turned into an empty reads unread or failed as a negative. Render its state: a placeholder while it is read, the cause when it failed.",
        );
      },
      LogicalExpression(node) {
        // Optional labels decorate the still-present attention collection; they are not its facts.
        const property = node.parent;
        const object = property?.parent;
        const call = object?.parent;
        if (
          path === "apps/web/src/components/zerops/ZeropsGroupDetail.tsx" &&
          property?.type === "Property" &&
          property.value === node &&
          getPropertyName(property.key).pipe(Option.getOrUndefined) === "mateNames" &&
          call?.type === "CallExpression" &&
          call.callee.type === "Identifier" &&
          call.callee.name === "projectAttention" &&
          compactSyntax(context, node) === "mateNames??EMPTY_MATE_NAMES"
        )
          return;
        if (node.operator !== "??" || !isEmptyDefault(context, node.right)) return;
        if (!isStoreRead(context, node.left, new Set())) return;
        if (isGuardedFieldDefault(context, node) || isStatusBearingDefault(context, node)) return;
        report(
          node,
          "A store read defaulted to an empty reads unread or failed as a negative. Render its Known state instead.",
        );
      },
    };
  },
});
