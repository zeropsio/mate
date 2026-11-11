import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { readReleaseSource } from "@t3tools/shared/releaseSource";
import { compareSemverVersions } from "@t3tools/shared/semver";
import * as Cause from "effect/Cause";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { parseSync, transformWithOxc } from "vite-plus";
import { parse as parseYaml } from "yaml";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

export type RollbackCompatibility =
  | { readonly rollbackCompatible: false }
  | { readonly rollbackCompatible: true; readonly compatibleFrom: string };

/**
 * Each read-back contract's fingerprint at one release, by name: its canonical text, compared
 * whole; undefined when it cannot be read.
 */
export type ContractFingerprints = Readonly<Record<string, string | undefined>>;

export interface RollbackEvidence {
  readonly previousTag: string;
  readonly candidateVersion: string;
  readonly ancestor: boolean;
  readonly previous: ContractFingerprints;
  readonly current: ContractFingerprints;
}

/** Every top-level statement of the module. */
const MODULE = "module";
/** The module's stored shapes: its types, schemas and data constants, not its functions or services. */
const SHAPES = "shapes";
type Selector = ReadonlyArray<string> | typeof MODULE | typeof SHAPES;

interface Contract {
  readonly name: string;
  /** A path ending in `/` covers every non-test module beneath it; names are top-level ones. */
  readonly roots: ReadonlyArray<readonly [path: string, selector: Selector]>;
}

/**
 * What a release reads back from the state a newer one leaves when an update rolls back to it.
 * Each contract is fingerprinted from the code of both releases: the top-level statements its
 * roots reach through local names and repository imports, comments and layout aside, wherever
 * they live. Code is followed through what runs, a stored shape through its types too, so a shape
 * that code only annotates (a record it serializes) is a root of its own. Code that stores nothing is no contract: the update drain, admission, startup and the
 * update route (their seam with zcp is the update protocol), the folds (a snapshot carries its
 * state version) and the import of the first crew store (read forward only).
 */
export const READ_BACK_CONTRACTS: ReadonlyArray<Contract> = [
  {
    name: "SQL migrations",
    roots: [
      ["apps/server/src/persistence/Migrations.ts", ["migrationEntries"]],
      ["apps/server/src/engine/store/migrations.ts", ["migrations", "ENGINE_MIGRATIONS_TABLE"]],
    ],
  },
  {
    name: "stored rows",
    roots: [
      ["apps/server/src/persistence/", SHAPES],
      ["apps/server/src/engine/store/", SHAPES],
      ["apps/server/src/engine/outbox/EffectOutbox.ts", ["EffectRow", "EffectRowState", "Row"]],
      ["apps/server/src/engine/wakes/WakeScheduler.ts", ["DueWake"]],
      ["apps/server/src/engine/wire/records.ts", SHAPES],
      ["apps/server/src/usage/UsageOutbox.ts", SHAPES],
      ["apps/server/src/zerops/ZeropsSetup.ts", ["StandUpRow"]],
      ["apps/server/src/zerops/crew/CrewStore.ts", SHAPES],
      [
        "apps/server/src/provider/Layers/ProviderSessionDirectory.ts",
        ["decodeProviderDriverKind", "mergeRuntimePayload", "toRuntimeBinding"],
      ],
      [
        "apps/server/src/provider/Services/ProviderSessionDirectory.ts",
        ["ProviderRuntimeBinding", "ProviderRuntimeBindingWithMetadata"],
      ],
    ],
  },
  {
    name: "engine events, commands and snapshot",
    roots: [
      ["packages/contracts/src/engine.ts", ["EngineEvent", "KnownEngineEvent"]],
      [
        "apps/server/src/engine/domain/command.ts",
        [
          "Command",
          "EventDraft",
          "EffectDraft",
          "ItemDetailDraft",
          "ItemDataDraft",
          "ImportedRecord",
        ],
      ],
      ["apps/server/src/engine/domain/state.ts", ["STATE_VERSION", "ConversationState"]],
      ["apps/server/src/engine/domain/ids.ts", MODULE],
    ],
  },
  {
    name: "orchestration events",
    roots: [["packages/contracts/src/orchestration.ts", ["OrchestrationEvent"]]],
  },
  {
    name: "crew events, commands and state",
    roots: [
      [
        "apps/server/src/zerops/crew/engine/events.ts",
        ["CrewEvent", "CREW_EVENT_VERSION", "isKnownCrewEvent"],
      ],
      [
        "apps/server/src/zerops/crew/engine/command.ts",
        ["CrewInput", "CREW_EFFECT_KINDS", "CrewEffectPayload"],
      ],
      ["apps/server/src/zerops/crew/engine/state.ts", ["CrewState"]],
      [
        "apps/server/src/zerops/crew/engine/CrewOwner.ts",
        ["StoredCrewEvent", "putTask", "appendLog", "memoryChange"],
      ],
      ["apps/server/src/zerops/crew/CrewMemory.ts", ["CrewMemoryChange", "CrewMemoryEntry"]],
    ],
  },
  {
    // Where they lie is the state directory's layout, evaluated below.
    name: "the files in the state directory",
    roots: [
      ["apps/server/src/serverSettings.ts", SHAPES],
      [
        "apps/server/src/serverSettings.ts",
        ["normalizeServerSettings", "providerEnvironmentSecretName", "usageLimitSourceSecretName"],
      ],
      ["apps/server/src/keybindings.ts", SHAPES],
      ["apps/server/src/serverRuntimeState.ts", SHAPES],
      ["apps/server/src/auth/ServerSecretStore.ts", ["make"]],
      ["apps/server/src/auth/SessionStore.ts", SHAPES],
      ["apps/server/src/auth/replayMarkers.ts", SHAPES],
      ["apps/server/src/attachmentPaths.ts", MODULE],
      ["apps/server/src/attachmentStore.ts", MODULE],
      [
        "apps/server/src/uploadsFolder.ts",
        ["recordPath", "readRecord", "writeRecord", "uploadsFileName"],
      ],
      ["apps/server/src/uploadsFolder.ts", ["KeptRecord"]],
      ["apps/server/src/zerops/ZeropsGitCredentialFile.ts", ["makeGitCredentialFile"]],
      ["apps/server/src/environment/ServerEnvironment.ts", ["make"]],
    ],
  },
  {
    // An adapter writes its cursor inline; what it reads back is the reader below.
    name: "provider resume cursors",
    roots: [
      [
        "apps/server/src/provider/Layers/ClaudeAdapter.ts",
        ["readClaudeResumeState", "ClaudeResumeState"],
      ],
      [
        "apps/server/src/provider/Layers/CodexSessionRuntime.ts",
        ["CodexResumeCursorSchema", "readResumeCursorThreadId"],
      ],
      ["apps/server/src/provider/Layers/CodexAdapter.ts", ["isCodexResumeCursorSchema"]],
      ["apps/server/src/provider/Layers/AntigravityAdapter.ts", ["decodeResumeCursor"]],
      ["apps/server/src/provider/Layers/CursorAdapter.ts", ["parseCursorResume"]],
      ["apps/server/src/provider/Layers/GrokAdapter.ts", ["parseGrokResume"]],
      ["apps/server/src/provider/Layers/OpenCodeAdapter.ts", ["parseOpenCodeResume"]],
      ["apps/server/src/update/NativeResume.ts", SHAPES],
    ],
  },
  {
    // What the pack inlines, what the manifest leaves for npm and the `define` constants it bakes.
    name: "the artifact's build",
    roots: [
      ["scripts/lib/cli-external-packages.ts", MODULE],
      ["scripts/lib/resolve-catalog.ts", MODULE],
      ["scripts/lib/public-config.ts", MODULE],
    ],
  },
];

export const STATE_LAYOUT = "the state directory's layout";
export const UPDATE_PROTOCOL = "the update protocol";
export const RUNTIME_DECLARATION = "the server's runtime declaration";
export const RUNTIME_DEPENDENCIES = "the server's runtime dependencies";

/**
 * The function a release derives every path of its state directory with. Its layout is the value
 * it returns for one canonical production base directory, not the code or the types it takes: the
 * configuration a server launches with is no state it leaves.
 */
export const STATE_LAYOUT_ROOT = ["apps/server/src/config.ts", "deriveServerPaths"] as const;
const CANONICAL_BASE_DIR = "/canonical-base-dir";

/** Every contract a release is judged by: the code contracts and the release's own files. */
export const CONTRACT_NAMES: ReadonlyArray<string> = [
  ...READ_BACK_CONTRACTS.map((contract) => contract.name),
  STATE_LAYOUT,
  UPDATE_PROTOCOL,
  RUNTIME_DECLARATION,
  RUNTIME_DEPENDENCIES,
];

const stableVersion = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const decodePackage = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);
const decodeProtocol = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ protocol: Schema.Literal(1) })),
);
const MANUAL: RollbackCompatibility = { rollbackCompatible: false };

const runtimeDeclaration = (encoded: string): string | undefined => {
  const decoded = decodePackage(encoded);
  return Option.isNone(decoded)
    ? undefined
    : JSON.stringify(
        Object.fromEntries(Object.entries(decoded.value).filter(([key]) => key !== "version")),
      );
};

/** A path with its `.` and `..` segments resolved. */
const normalizePath = (path: string): string =>
  path
    .split("/")
    .reduce<Array<string>>((segments, segment) => {
      if (segment === "..") segments.pop();
      else if (segment !== "." && segment !== "") segments.push(segment);
      return segments;
    }, [])
    .join("/");

interface LockImporter {
  readonly dependencies?: Record<string, { readonly version?: string } | undefined>;
  readonly devDependencies?: Record<string, { readonly version?: string } | undefined>;
}
type LockSnapshots = Record<
  string,
  | {
      readonly dependencies?: Record<string, string>;
      readonly optionalDependencies?: Record<string, string>;
    }
  | undefined
>;

/**
 * The lockfile restricted to what the server bundle resolves: the `apps/server` production
 * dependencies, those of every workspace package it links (the bundle inlines them with their
 * own dependencies), and all transitive snapshots. An app is never inlined: the server links
 * `@t3tools/web` only to build the bundle it serves, so web-only bumps stay out. Tooling-only
 * changes leave it identical; an unreadable lockfile has none.
 */
const serverRuntimeClosure = (lock: string): string | undefined => {
  try {
    const parsed = parseYaml(lock) as {
      importers?: Record<string, LockImporter | undefined>;
      snapshots?: LockSnapshots;
    };
    const { importers, snapshots } = parsed;
    if (importers?.["apps/server"] === undefined || snapshots === undefined) return undefined;
    const visited = new Map<string, unknown>();
    const seenImporters = new Set<string>();
    const queue: Array<string> = [];
    const pushImporter = (id: string) => {
      if (seenImporters.has(id)) return;
      seenImporters.add(id);
      const importer = importers[id];
      if (importer === undefined) throw new Error(`unknown importer ${id}`);
      visit(id, importer.dependencies, false);
      visit(id, importer.devDependencies, true);
    };
    const visit = (from: string, section: LockImporter["dependencies"], linkedOnly: boolean) => {
      for (const [name, entry] of Object.entries(section ?? {})) {
        const version = entry?.version ?? "";
        if (version.startsWith("link:")) {
          const linked = normalizePath(`${from}/${version.slice("link:".length)}`);
          if (!linked.startsWith("apps/")) pushImporter(linked);
        } else if (!linkedOnly) {
          queue.push(`${name}@${version}`);
        }
      }
    };
    pushImporter("apps/server");
    for (let key = queue.pop(); key !== undefined; key = queue.pop()) {
      if (visited.has(key)) continue;
      const snapshot = snapshots[key];
      visited.set(key, snapshot ?? null);
      for (const [name, version] of Object.entries({
        ...snapshot?.dependencies,
        ...snapshot?.optionalDependencies,
      }))
        queue.push(`${name}@${version}`);
    }
    return JSON.stringify([...visited].sort(([a], [b]) => a.localeCompare(b)));
  } catch {
    return undefined;
  }
};

/** An ESTree node as the walk below reads it. */
interface AstNode {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
}

const isNode = (value: unknown): value is AstNode =>
  typeof value === "object" && value !== null && typeof (value as AstNode).type === "string";

/** An import or re-export: the module specifier and the name it binds there (`default`, `*`). */
interface Binding {
  readonly source: string;
  readonly name: string;
}

interface ModuleStatement {
  readonly text: string;
  /** What it declares; none for a statement that runs on import. */
  readonly names: ReadonlyArray<string>;
  /** Every name its code refers to, property names aside. */
  readonly uses: ReadonlyArray<string>;
  /**
   * Every name only its types refer to. A stored shape is followed through them; code is followed
   * only through what runs, as the types of the values it is handed (the configuration it
   * launches with among them) are no state it stores.
   */
  readonly types: ReadonlyArray<string>;
  /**
   * Names only its types query (`typeof x`). The type of a service's implementation is no stored
   * shape, so a query reaches only a declaration that is one, such as a schema.
   */
  readonly queries: ReadonlyArray<string>;
  readonly shape: boolean;
  /** Where its declaration lies in the source, without an `export` keyword. */
  readonly span: readonly [start: number, end: number];
}

interface ParsedModule {
  readonly statements: ReadonlyArray<ModuleStatement>;
  readonly imports: ReadonlyMap<string, Binding>;
  readonly exports: ReadonlyMap<string, Binding | { readonly local: string }>;
  readonly stars: ReadonlyArray<string>;
}

/** A statement's code without its comments or layout. */
const statementText = (
  source: string,
  comments: ReadonlyArray<{ readonly start: number; readonly end: number }>,
  statement: AstNode,
): string => {
  let text = "";
  let at = statement.start;
  for (const comment of comments) {
    if (comment.end <= at || comment.start >= statement.end) continue;
    text += source.slice(at, comment.start);
    at = comment.end;
  }
  return (text + source.slice(at, statement.end)).replace(/\s+/gu, " ").trim();
};

const nameOf = (node: unknown): string =>
  isNode(node) ? (node.type === "Identifier" ? String(node.name) : String(node.value)) : "";

/** The identifiers a binding pattern declares. */
const patternNames = (pattern: unknown): ReadonlyArray<string> => {
  if (!isNode(pattern)) return [];
  switch (pattern.type) {
    case "Identifier":
      return [String(pattern.name)];
    case "ObjectPattern":
      return (pattern.properties as ReadonlyArray<AstNode>).flatMap((property) =>
        patternNames(property.type === "RestElement" ? property.argument : property.value),
      );
    case "ArrayPattern":
      return (pattern.elements as ReadonlyArray<unknown>).flatMap(patternNames);
    case "RestElement":
      return patternNames(pattern.argument);
    case "AssignmentPattern":
      return patternNames(pattern.left);
    default:
      return [];
  }
};

const declaredNames = (declaration: AstNode): ReadonlyArray<string> => {
  switch (declaration.type) {
    case "VariableDeclaration":
      return (declaration.declarations as ReadonlyArray<AstNode>).flatMap((declarator) =>
        patternNames(declarator.id),
      );
    case "FunctionDeclaration":
    case "ClassDeclaration":
    case "TSInterfaceDeclaration":
    case "TSTypeAliasDeclaration":
    case "TSEnumDeclaration":
    case "TSModuleDeclaration":
      return isNode(declaration.id) && declaration.id.type === "Identifier"
        ? [String(declaration.id.name)]
        : [];
    default:
      return [];
  }
};

/** `x.y` when the node names member `y` of identifier `x`, in code or in a type. */
const qualifiedName = (node: AstNode): string | undefined => {
  const [object, member] =
    node.type === "MemberExpression" && node.computed !== true
      ? [node.object, node.property]
      : node.type === "TSQualifiedName"
        ? [node.left, node.right]
        : [];
  return isNode(object) && object.type === "Identifier" && isNode(member)
    ? `${String(object.name)}.${nameOf(member)}`
    : undefined;
};

/** The TypeScript nodes that carry code: every other one is a type, erased when the code runs. */
const TS_VALUE_NODES = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "TSInstantiationExpression",
  "TSEnumDeclaration",
  "TSEnumBody",
  "TSEnumMember",
  "TSModuleDeclaration",
  "TSModuleBlock",
  "TSExportAssignment",
  "TSImportEqualsDeclaration",
  "TSExternalModuleReference",
  "TSParameterProperty",
]);

type UseContext = "uses" | "types" | "queries";

/**
 * The names code refers to: identifiers, except a non-computed property or member name; a member
 * of an identifier as `x.y`, so a namespace import reaches only the exports it reads. A name in a
 * type counts as a type, one only a type query (`typeof x`) refers to as a query.
 */
const usedNames = (
  node: unknown,
  into: Readonly<Record<UseContext, Set<string>>>,
  context: UseContext = "uses",
): void => {
  if (Array.isArray(node)) {
    for (const child of node) usedNames(child, into, context);
    return;
  }
  if (!isNode(node)) return;
  const at: UseContext =
    node.type === "TSTypeQuery"
      ? "queries"
      : context === "uses" && node.type.startsWith("TS") && !TS_VALUE_NODES.has(node.type)
        ? "types"
        : context;
  const qualified = qualifiedName(node);
  if (qualified !== undefined) {
    into[at].add(qualified);
    return;
  }
  if (node.type === "Identifier") into[at].add(String(node.name));
  for (const [key, child] of Object.entries(node)) {
    const propertyName =
      node.computed !== true &&
      (key === "key" || (key === "property" && node.type === "MemberExpression"));
    if (propertyName || (key === "right" && node.type === "TSQualifiedName")) continue;
    usedNames(child, into, at);
  }
};

/** A function, an Effect or a Layer: behaviour, not a stored shape. */
const isBehaviour = (init: unknown): boolean => {
  if (!isNode(init)) return true;
  if (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression") return true;
  let callee: unknown = init.type === "CallExpression" ? init.callee : undefined;
  while (isNode(callee) && callee.type === "CallExpression") callee = callee.callee;
  return (
    isNode(callee) &&
    callee.type === "MemberExpression" &&
    isNode(callee.object) &&
    callee.object.type === "Identifier" &&
    (callee.object.name === "Effect" || callee.object.name === "Layer")
  );
};

const isShape = (declaration: AstNode, source: string): boolean => {
  switch (declaration.type) {
    case "TSInterfaceDeclaration":
    case "TSTypeAliasDeclaration":
    case "TSEnumDeclaration":
      return true;
    case "ClassDeclaration": {
      const base = declaration.superClass;
      const text = isNode(base) ? source.slice(base.start, base.end) : "";
      return /\bSchema\./u.test(text) && !text.includes("TaggedError");
    }
    case "VariableDeclaration":
      return (declaration.declarations as ReadonlyArray<AstNode>).every(
        (declarator) => !isBehaviour(declarator.init),
      );
    default:
      return false;
  }
};

/**
 * A service's tag stands for its identity alone: what a service stores lies in its implementation,
 * which a contract names as a root, never in the interface code asks it through. The server's
 * configuration is one such interface: the environment it launches with is no state it leaves.
 */
const serviceTag = (declaration: AstNode, source: string): string | undefined => {
  const base = declaration.superClass;
  if (declaration.type !== "ClassDeclaration" || !isNode(base) || base.type !== "CallExpression")
    return undefined;
  if (!/^Context\.Service\b/u.test(source.slice(base.start, base.end))) return undefined;
  const [key] = base.arguments as ReadonlyArray<AstNode>;
  return `service ${nameOf(declaration.id)} ${key === undefined ? "" : source.slice(key.start, key.end)}`;
};

const parseModule = (path: string, source: string): ParsedModule | undefined => {
  const parsed = parseSync(path, source);
  if (parsed.errors.length > 0) return undefined;
  const statements: Array<ModuleStatement> = [];
  const imports = new Map<string, Binding>();
  const exports = new Map<string, Binding | { readonly local: string }>();
  const stars: Array<string> = [];
  const add = (statement: AstNode, declaration: AstNode, names: ReadonlyArray<string>) => {
    const used = { uses: new Set<string>(), types: new Set<string>(), queries: new Set<string>() };
    const tag = serviceTag(declaration, source);
    if (tag === undefined) usedNames(declaration, used);
    statements.push({
      text: tag ?? statementText(source, parsed.comments, statement),
      names,
      uses: [...used.uses],
      types: [...used.types].filter((name) => !used.uses.has(name)),
      queries: [...used.queries].filter((name) => !used.uses.has(name) && !used.types.has(name)),
      shape: isShape(declaration, source),
      span: [declaration.start, declaration.end],
    });
  };
  for (const statement of parsed.program.body as unknown as ReadonlyArray<AstNode>) {
    const from = isNode(statement.source) ? String(statement.source.value) : undefined;
    switch (statement.type) {
      case "ImportDeclaration":
        for (const specifier of statement.specifiers as ReadonlyArray<AstNode>)
          imports.set(nameOf(specifier.local), {
            source: from ?? "",
            name:
              specifier.type === "ImportDefaultSpecifier"
                ? "default"
                : specifier.type === "ImportNamespaceSpecifier"
                  ? "*"
                  : nameOf(specifier.imported),
          });
        break;
      case "ExportAllDeclaration":
        if (from === undefined) break;
        if (statement.exported === null) stars.push(from);
        else exports.set(nameOf(statement.exported), { source: from, name: "*" });
        break;
      case "ExportNamedDeclaration": {
        for (const specifier of statement.specifiers as ReadonlyArray<AstNode>)
          exports.set(
            nameOf(specifier.exported),
            from === undefined
              ? { local: nameOf(specifier.local) }
              : { source: from, name: nameOf(specifier.local) },
          );
        if (!isNode(statement.declaration)) break;
        const names = declaredNames(statement.declaration);
        for (const name of names) exports.set(name, { local: name });
        add(statement, statement.declaration, names);
        break;
      }
      case "ExportDefaultDeclaration": {
        const declaration = statement.declaration;
        if (isNode(declaration) && declaration.type === "Identifier") {
          exports.set("default", { local: String(declaration.name) });
          break;
        }
        exports.set("default", { local: "default" });
        if (isNode(declaration))
          add(statement, declaration, ["default", ...declaredNames(declaration)]);
        break;
      }
      default:
        add(statement, statement, declaredNames(statement));
    }
  }
  return { statements, imports, exports, stars };
};

/** One release's files: every path, and a reader returning undefined for a path it lacks. */
export interface ReleaseTree<E> {
  readonly paths: ReadonlySet<string>;
  readonly read: (path: string) => Effect.Effect<string | undefined, E>;
}

/** Parsed modules, lockfile closures and state layouts by content, shared by a walk's releases. */
interface FingerprintCache {
  readonly modules: Map<string, ParsedModule | undefined>;
  readonly locks: Map<string, string | undefined>;
  readonly layouts: Map<string, ContractReading>;
}

const makeFingerprintCache = (): FingerprintCache => ({
  modules: new Map(),
  locks: new Map(),
  layouts: new Map(),
});

/** A contract as one release has it: its fingerprint, and what it is made of for `--list`. */
export interface ContractReading {
  readonly fingerprint: string | undefined;
  readonly members: ReadonlyArray<string>;
}

const isSourceModule = (path: string): boolean =>
  /\.tsx?$/u.test(path) && !/\.test\.tsx?$/u.test(path) && !path.endsWith(".d.ts");

/** The file an export entry of a workspace package's manifest names. */
const exportTarget = (entry: unknown): string | undefined => {
  if (typeof entry === "string") return entry;
  if (typeof entry !== "object" || entry === null) return undefined;
  const conditions = entry as Record<string, unknown>;
  for (const condition of ["import", "default", "types"])
    if (typeof conditions[condition] === "string") return conditions[condition];
  return undefined;
};

/**
 * The state directory's layout at one release: every path `STATE_LAYOUT_ROOT` derives for the
 * canonical base directory, relative to it, by name. The function runs with what it reaches in
 * its own module and the packages from outside the repository it imports; one that reaches
 * another repository module, or that fails, leaves the layout unreadable.
 */
const evaluateStateLayout = async (
  source: string,
  isExternal: (specifier: string) => boolean,
): Promise<ContractReading> => {
  const [file, root] = STATE_LAYOUT_ROOT;
  const unreadable = (why: string): ContractReading => ({
    fingerprint: undefined,
    members: [`${file}: ${why}`],
  });
  try {
    const { code } = await transformWithOxc(source, file);
    const parsed = parseModule(file.replace(/\.ts$/u, ".js"), code);
    if (parsed === undefined) return unreadable("does not parse");
    const statements = new Set<ModuleStatement>();
    const imports = new Map<string, Binding>();
    const pending: Array<string> = [root];
    for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
      const declarations = parsed.statements.filter((statement) => statement.names.includes(name));
      for (const statement of declarations)
        if (!statements.has(statement)) {
          statements.add(statement);
          pending.push(...statement.uses.map((use) => use.split(".", 1)[0] ?? use));
        }
      const binding = parsed.imports.get(name);
      if (declarations.length > 0 || binding === undefined) continue;
      if (!isExternal(binding.source)) return unreadable(`${root} reaches ${binding.source}`);
      imports.set(name, binding);
    }
    if (statements.size === 0) return unreadable(`declares no ${root}`);
    const bindings = [...imports];
    const modules: ReadonlyArray<unknown> = await Promise.all(
      bindings.map(([, binding]) => import(binding.source)),
    );
    const body = [
      ...bindings.map(
        ([local, binding], index) =>
          `const ${local} = modules[${index}]${binding.name === "*" ? "" : `[${JSON.stringify(binding.name)}]`};`,
      ),
      ...[...statements]
        .toSorted((a, b) => a.span[0] - b.span[0])
        .map((statement) => code.slice(...statement.span)),
      `return ${root};`,
    ].join("\n");
    // `new Function`: the layout is the value the release's own code derives.
    // What it is the run tells: anything but a function returning the paths fails it.
    const derive: (
      baseDir: string,
      devUrl: undefined,
      options: object,
    ) => Effect.Effect<object, never, Path.Path> = new Function("modules", body)(modules);
    const exit = Effect.runSyncExit(
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const paths = yield* derive(CANONICAL_BASE_DIR, undefined, {});
        return Object.entries(paths).map(([name, value]: [string, unknown]) =>
          typeof value === "string"
            ? `${name} = ${path.relative(CANONICAL_BASE_DIR, value)}`
            : `${name} = ${JSON.stringify(value)}`,
        );
      }).pipe(Effect.provide(Path.layer)),
    );
    if (Exit.isFailure(exit)) return unreadable(`${root} fails: ${Cause.pretty(exit.cause)}`);
    const members = exit.value.toSorted();
    return { fingerprint: members.join("\n"), members };
  } catch (error) {
    return unreadable(String(error));
  }
};

/**
 * Every contract at one release. A root module that is missing or does not parse, a root name its
 * module no longer declares, or any reached module that does not parse leaves its contract
 * unreadable, which is manual.
 */
export const contractReadings = <E>(
  tree: ReleaseTree<E>,
  cache: FingerprintCache = makeFingerprintCache(),
) =>
  Effect.gen(function* () {
    const load = Effect.fnUntraced(function* (path: string) {
      const source = yield* tree.read(path);
      if (source === undefined) return undefined;
      if (!cache.modules.has(source)) cache.modules.set(source, parseModule(path, source));
      return cache.modules.get(source);
    });

    const packages = new Map<string, { readonly dir: string; readonly exports: unknown }>();
    for (const path of tree.paths) {
      if (!/^packages\/[^/]+\/package\.json$/u.test(path)) continue;
      const manifest = decodePackage((yield* tree.read(path)) ?? "");
      if (Option.isSome(manifest) && typeof manifest.value.name === "string")
        packages.set(manifest.value.name, {
          dir: path.slice(0, -"/package.json".length),
          exports: manifest.value.exports ?? { ".": manifest.value.main },
        });
    }
    /** A repository module, undefined for a package outside it, null for one that is missing. */
    const resolve = (from: string, specifier: string): string | null | undefined => {
      const exists = (path: string) => (tree.paths.has(path) ? path : undefined);
      if (specifier.startsWith(".")) {
        const base = normalizePath(`${from.slice(0, from.lastIndexOf("/"))}/${specifier}`);
        return (
          exists(base.replace(/\.js$/u, ".ts")) ??
          exists(base) ??
          exists(`${base}.ts`) ??
          exists(`${base}.tsx`) ??
          exists(`${base}/index.ts`) ??
          null
        );
      }
      for (const [name, { dir, exports }] of packages) {
        if (specifier !== name && !specifier.startsWith(`${name}/`)) continue;
        const subpath = specifier === name ? "." : `./${specifier.slice(name.length + 1)}`;
        const target =
          typeof exports === "object" && exports !== null
            ? exportTarget((exports as Record<string, unknown>)[subpath])
            : subpath === "."
              ? exportTarget(exports)
              : undefined;
        return target === undefined ? null : (exists(normalizePath(`${dir}/${target}`)) ?? null);
      }
      return undefined;
    };

    type Want =
      | {
          readonly kind: "local" | "export";
          readonly file: string;
          readonly name: string;
          readonly shapeOnly: boolean;
        }
      | { readonly kind: "module" | "shapes" | "json"; readonly file: string };

    const closure = Effect.fnUntraced(function* (contract: Contract) {
      const texts: Array<string> = [];
      const members = new Set<string>();
      const unreadable = (why: string): ContractReading => ({
        fingerprint: undefined,
        members: [why],
      });
      const wants: Array<Want> = [];
      for (const [root, selector] of contract.roots) {
        const files = root.endsWith("/")
          ? [...tree.paths].filter((path) => path.startsWith(root) && isSourceModule(path))
          : [root];
        for (const file of files) {
          const parsed = yield* load(file);
          if (parsed === undefined) return unreadable(`${file}: missing or does not parse`);
          if (selector === MODULE || selector === SHAPES) {
            wants.push({ kind: selector === MODULE ? "module" : "shapes", file });
            continue;
          }
          for (const name of selector) {
            const declared =
              parsed.statements.some((statement) => statement.names.includes(name)) ||
              parsed.imports.has(name);
            if (!declared) return unreadable(`${file}: declares no ${name}`);
            wants.push({ kind: "local", file, name, shapeOnly: false });
          }
        }
      }
      const seen = new Set<string>();
      const included = new Set<string>();
      const follow = (from: string, binding: Binding, shapeOnly = false) => {
        const target = resolve(from, binding.source);
        if (target === undefined) {
          texts.push(`import ${binding.name} from ${binding.source}`);
          members.add(`${binding.source}: ${binding.name}`);
        } else if (target === null) {
          texts.push(`missing ${binding.source} from ${from}`);
          members.add(`${from}: missing ${binding.source}`);
        } else if (target.endsWith(".json")) wants.push({ kind: "json", file: target });
        else if (binding.name === "*") wants.push({ kind: "module", file: target });
        else wants.push({ kind: "export", file: target, name: binding.name, shapeOnly });
      };
      for (let want = wants.pop(); want !== undefined; want = wants.pop()) {
        const key = `${want.kind}\0${want.file}\0${"name" in want ? `${want.name}\0${want.shapeOnly}` : ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (want.kind === "json") {
          // A manifest's own version is the release, not a shape it stores.
          texts.push(`json ${runtimeDeclaration((yield* tree.read(want.file)) ?? "")}`);
          members.add(`${want.file}: json`);
          continue;
        }
        const parsed = yield* load(want.file);
        if (parsed === undefined) return unreadable(`${want.file}: does not parse`);
        const include = (statement: ModuleStatement) => {
          if (included.size === included.add(`${want.file}\0${statement.text}`).size) return;
          texts.push(statement.text);
          members.add(`${want.file}: ${statement.names.join(", ") || "(runs on import)"}`);
          for (const name of statement.uses)
            wants.push({ kind: "local", file: want.file, name, shapeOnly: false });
          if (statement.shape) {
            for (const name of statement.types)
              wants.push({ kind: "local", file: want.file, name, shapeOnly: false });
            for (const name of statement.queries)
              wants.push({ kind: "local", file: want.file, name, shapeOnly: true });
          }
          // What runs on import comes with the first statement taken from its module.
          if (statement.names.length > 0)
            for (const effect of parsed.statements) if (effect.names.length === 0) include(effect);
        };
        switch (want.kind) {
          case "local": {
            const [name = "", member] = want.name.split(".", 2);
            const declarations = parsed.statements.filter(
              (statement) => statement.names.includes(name) && (statement.shape || !want.shapeOnly),
            );
            for (const statement of declarations) include(statement);
            const binding = parsed.imports.get(name);
            if (declarations.length > 0 || binding === undefined) break;
            const target = resolve(want.file, binding.source);
            // A repository namespace is read by the exports its code names.
            if (binding.name === "*" && member !== undefined && typeof target === "string")
              wants.push({ kind: "export", file: target, name: member, shapeOnly: want.shapeOnly });
            else follow(want.file, binding, want.shapeOnly);
            break;
          }
          case "export": {
            const entry = parsed.exports.get(want.name);
            if (entry !== undefined && "local" in entry)
              wants.push({
                kind: "local",
                file: want.file,
                name: entry.local,
                shapeOnly: want.shapeOnly,
              });
            else if (entry !== undefined) follow(want.file, entry, want.shapeOnly);
            else
              for (const star of parsed.stars)
                if (resolve(want.file, star))
                  follow(want.file, { source: star, name: want.name }, want.shapeOnly);
            break;
          }
          case "module":
            for (const statement of parsed.statements) include(statement);
            for (const entry of parsed.exports.values())
              if (!("local" in entry)) follow(want.file, entry);
            for (const star of parsed.stars) follow(want.file, { source: star, name: "*" });
            break;
          case "shapes":
            for (const statement of parsed.statements) if (statement.shape) include(statement);
            break;
        }
      }
      return {
        fingerprint: texts.sort().join("\n"),
        members: [...members].toSorted(),
      } satisfies ContractReading;
    });

    const fileReading = (file: string, fingerprint: string | undefined): ContractReading => ({
      fingerprint,
      members: [fingerprint === undefined ? `${file}: unreadable` : file],
    });
    const readings: Record<string, ContractReading> = {};
    for (const contract of READ_BACK_CONTRACTS) readings[contract.name] = yield* closure(contract);
    const [layoutFile] = STATE_LAYOUT_ROOT;
    const layoutSource = yield* tree.read(layoutFile);
    if (layoutSource !== undefined && !cache.layouts.has(layoutSource))
      cache.layouts.set(
        layoutSource,
        yield* Effect.promise(() =>
          evaluateStateLayout(
            layoutSource,
            (specifier) => resolve(layoutFile, specifier) === undefined,
          ),
        ),
      );
    readings[STATE_LAYOUT] =
      layoutSource === undefined
        ? fileReading(layoutFile, undefined)
        : (cache.layouts.get(layoutSource) ?? fileReading(layoutFile, undefined));
    const protocolFile = "apps/server/update-protocol.json";
    const protocol = decodeProtocol((yield* tree.read(protocolFile)) ?? "");
    readings[UPDATE_PROTOCOL] = fileReading(
      protocolFile,
      Option.isSome(protocol) ? String(protocol.value.protocol) : undefined,
    );
    const packageFile = "apps/server/package.json";
    readings[RUNTIME_DECLARATION] = fileReading(
      packageFile,
      runtimeDeclaration((yield* tree.read(packageFile)) ?? ""),
    );
    const lock = (yield* tree.read("pnpm-lock.yaml")) ?? "";
    if (!cache.locks.has(lock)) cache.locks.set(lock, serverRuntimeClosure(lock));
    readings[RUNTIME_DEPENDENCIES] = fileReading("pnpm-lock.yaml", cache.locks.get(lock));
    return readings as Readonly<Record<string, ContractReading>>;
  });

/** The fingerprint of every contract at one release. */
export const contractFingerprints = <E>(tree: ReleaseTree<E>, cache?: FingerprintCache) =>
  Effect.map(contractReadings(tree, cache), (readings): ContractFingerprints =>
    Object.fromEntries(
      Object.entries(readings).map(([name, reading]) => [name, reading.fingerprint]),
    ),
  );

/**
 * Why the release needs an attended update, or undefined when it may update automatically.
 * A release is rollback-compatible from the previous stable when every read-back contract has the
 * same fingerprint in both, whatever files changed or moved.
 */
export function rollbackBlocker(evidence: RollbackEvidence): string | undefined {
  const from = evidence.previousTag.startsWith("v") ? evidence.previousTag.slice(1) : "";
  if (!stableVersion.test(from))
    return `previous tag ${evidence.previousTag} is not a stable release`;
  if (!stableVersion.test(evidence.candidateVersion))
    return `candidate ${evidence.candidateVersion} is not a stable version`;
  if (compareSemverVersions(from, evidence.candidateVersion) >= 0)
    return `candidate ${evidence.candidateVersion} does not follow ${evidence.previousTag}`;
  if (!evidence.ancestor) return `${evidence.previousTag} is not an ancestor of the candidate`;
  const differences = CONTRACT_NAMES.flatMap((name) => {
    const before = evidence.previous[name];
    const after = evidence.current[name];
    if (before === undefined) return [`${name} cannot be read in ${evidence.previousTag}`];
    if (after === undefined) return [`${name} cannot be read in ${evidence.candidateVersion}`];
    return before === after ? [] : [`${name} changed`];
  });
  return differences.length === 0
    ? undefined
    : `the state it reads back differs: ${differences.join("; ")}`;
}

export function rollbackCompatibility(evidence: RollbackEvidence): RollbackCompatibility {
  return rollbackBlocker(evidence) === undefined
    ? { rollbackCompatible: true, compatibleFrom: evidence.previousTag.slice(1) }
    : MANUAL;
}

/** The paths a release's contracts can reach. */
const TREE_PATHS = ["apps/server", "packages", "scripts/lib", "pnpm-lock.yaml"];

/** Runs git in `cwd`: its output and exit code. */
const gitIn = (cwd?: string) =>
  Effect.map(ChildProcessSpawner.ChildProcessSpawner, (spawner) =>
    Effect.fnUntraced(function* (args: ReadonlyArray<string>) {
      const child = yield* spawner.spawn(ChildProcess.make("git", args, { stderr: "ignore", cwd }));
      const [output, code] = yield* Effect.all(
        [Stream.mkString(Stream.decodeText(child.stdout)), child.exitCode],
        { concurrency: "unbounded" },
      );
      return { output, code: Number(code) };
    }, Effect.scoped),
  );

type Git = Effect.Success<ReturnType<typeof gitIn>>;

/** A release's files at `ref`, blobs read once by content; undefined when git cannot list them. */
const releaseTreeAt = Effect.fnUntraced(function* (
  git: Git,
  ref: string,
  blobs: Map<string, string>,
) {
  const listing = yield* git(["ls-tree", "-r", "-z", ref, "--", ...TREE_PATHS]);
  const shas = new Map<string, string>();
  for (const entry of listing.output.split("\0")) {
    const tab = entry.indexOf("\t");
    const [, type, sha] = entry.slice(0, tab).split(" ");
    if (tab > 0 && type === "blob" && sha !== undefined) shas.set(entry.slice(tab + 1), sha);
  }
  if (listing.code !== 0 || shas.size === 0) return undefined;
  const read = Effect.fnUntraced(function* (path: string) {
    const sha = shas.get(path);
    if (sha === undefined) return undefined;
    if (!blobs.has(sha)) {
      const blob = yield* git(["cat-file", "blob", sha]);
      if (blob.code !== 0) return undefined;
      blobs.set(sha, blob.output);
    }
    return blobs.get(sha);
  });
  return { paths: new Set(shas.keys()), read };
});

/**
 * The candidate's rollback range over the published stable history: compatibleFrom is the oldest
 * published release R such that every release after R, the candidate included, is
 * rollback-compatible with the one before it, so a Mate several compatible releases behind still
 * updates automatically. The walk logs each step's verdict and stops at the first manual one. A
 * failed or incomplete git probe never stamps permission into a release.
 */
export const readRollbackCompatibility = Effect.fn("readRollbackCompatibility")(
  function* (publishedTags: ReadonlyArray<string>, candidateVersion: string, cwd?: string) {
    const git = yield* gitIn(cwd);
    const blobs = new Map<string, string>();
    const cache = makeFingerprintCache();
    // The walk reads each release twice in a row, as the newer and then the older side of a step.
    let last: { readonly ref: string; readonly fingerprints?: ContractFingerprints } | undefined;
    const fingerprintsAt = Effect.fnUntraced(function* (ref: string) {
      if (last?.ref === ref) return last.fingerprints;
      const tree = yield* releaseTreeAt(git, ref, blobs);
      const fingerprints =
        tree === undefined ? undefined : yield* contractFingerprints(tree, cache);
      last = fingerprints === undefined ? { ref } : { ref, fingerprints };
      return fingerprints;
    });
    /** Why `currentRef` (release `currentVersion`) is not rollback-compatible with `previousTag`. */
    const stepBlocker = Effect.fnUntraced(function* (
      previousTag: string,
      currentRef: string,
      currentVersion: string,
    ) {
      const previousSource = yield* readReleaseSource(previousTag, git);
      const currentSource = yield* readReleaseSource(currentRef, git);
      if (previousSource === undefined || currentSource === undefined)
        return `the release source of ${previousTag} or ${currentRef} cannot be read`;
      const ancestor = yield* git(["merge-base", "--is-ancestor", previousSource, currentSource]);
      if (ancestor.code !== 0) return `${previousTag} is not an ancestor of ${currentRef}`;
      const current = yield* fingerprintsAt(currentRef);
      const previous = yield* fingerprintsAt(previousTag);
      if (previous === undefined || current === undefined)
        return `git could not list the files of ${previousTag} or ${currentRef}`;
      return rollbackBlocker({
        previousTag,
        candidateVersion: currentVersion,
        ancestor: true,
        previous,
        current,
      });
    });
    const history = publishedTags
      .filter(
        (tag) =>
          tag.startsWith("v") &&
          stableVersion.test(tag.slice(1)) &&
          stableVersion.test(candidateVersion) &&
          compareSemverVersions(tag.slice(1), candidateVersion) < 0,
      )
      .toSorted((a, b) => compareSemverVersions(b.slice(1), a.slice(1)));
    if (history.length === 0) {
      yield* Effect.logInfo(
        `[release] manual update: no published stable release precedes ${candidateVersion}`,
      );
      return MANUAL;
    }
    let currentRef = "HEAD";
    let currentVersion = candidateVersion;
    let compatibleFrom: string | undefined;
    for (const tag of history) {
      const blocker = yield* stepBlocker(tag, currentRef, currentVersion);
      if (blocker !== undefined) {
        yield* Effect.logInfo(
          compatibleFrom === undefined
            ? `[release] manual update: ${tag} → ${candidateVersion}: ${blocker}`
            : `[release] rollback-compatible from ${compatibleFrom}; ${tag} → ${currentVersion} is manual: ${blocker}`,
        );
        break;
      }
      yield* Effect.logInfo(
        `[release] ${tag} → ${currentVersion}: every read-back contract is unchanged`,
      );
      compatibleFrom = tag.slice(1);
      currentRef = tag;
      currentVersion = compatibleFrom;
    }
    return compatibleFrom === undefined
      ? MANUAL
      : ({ rollbackCompatible: true, compatibleFrom } as const);
  },
  Effect.orElseSucceed(() => MANUAL),
);

/** `--list [ref]`: what each contract is made of at a release (HEAD by default), so an over-reach shows. */
const listContracts = Effect.fn("listContracts")(function* (ref: string) {
  const tree = yield* releaseTreeAt(yield* gitIn(), ref, new Map());
  if (tree === undefined) return yield* Effect.fail(`git cannot list the files of ${ref}`);
  for (const [name, reading] of Object.entries(yield* contractReadings(tree))) {
    yield* Console.log(
      `${name}${reading.fingerprint === undefined ? " (unreadable)" : ""}: ${reading.members.length}`,
    );
    for (const member of reading.members) yield* Console.log(`  ${member}`);
  }
});

if (import.meta.main) {
  const [flag, ref = "HEAD"] = process.argv.slice(2);
  (flag === "--list"
    ? listContracts(ref)
    : Effect.fail("usage: releaseRollbackCompatibility.ts --list [ref]")
  ).pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}
