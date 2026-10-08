// @effect-diagnostics nodeBuiltinImport:off -- The guard CLI's synchronous filesystem cache.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { parseSync } from "oxc-parser";
import * as Schema from "effect/Schema";

const CachedFileSchema = Schema.Struct({
  key: Schema.String,
  digest: Schema.String,
  findings: Schema.Array(
    Schema.Struct({ ruleName: Schema.String, kind: Schema.String, fingerprint: Schema.String }),
  ),
});
const decodeCachedFile = Schema.decodeUnknownSync(Schema.fromJsonString(CachedFileSchema));
export type CachedGuardFinding = (typeof CachedFileSchema.Type)["findings"][number];

const PackageSchema = Schema.Struct({
  name: Schema.String,
  dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  optionalDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  peerDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  exports: Schema.optional(Schema.Unknown),
});
const decodePackage = Schema.decodeUnknownSync(Schema.fromJsonString(PackageSchema));
const decodeExport = Schema.decodeUnknownSync(
  Schema.Union([Schema.String, Schema.Struct({ import: Schema.String })]),
);
const decodeConfig = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      jsPlugins: Schema.optional(Schema.Array(Schema.String)),
      options: Schema.optional(
        Schema.Struct({
          typeAware: Schema.optional(Schema.Boolean),
          typeCheck: Schema.optional(Schema.Boolean),
        }),
      ),
    }),
  ),
);

const packageAt = (from: string, name: string): string | undefined => {
  for (let directory = from; ; directory = NodePath.dirname(directory)) {
    const manifest = NodePath.join(directory, "node_modules", name, "package.json");
    if (NodeFS.existsSync(manifest)) return NodeFS.realpathSync(manifest);
    if (directory === NodePath.dirname(directory)) return undefined;
  }
};
const packageName = (specifier: string) =>
  specifier
    .split("/")
    .slice(0, specifier.startsWith("@") ? 2 : 1)
    .join("/");
const hashPackageTree = (manifest: string): string => {
  const hash = NodeCrypto.createHash("sha256");
  const visited = new Set<string>();
  const visit = (manifest: string) => {
    if (visited.has(manifest)) return;
    visited.add(manifest);
    const root = NodePath.dirname(manifest);
    const metadata = decodePackage(NodeFS.readFileSync(manifest, "utf8"));
    const walk = (directory: string) => {
      for (const entry of NodeFS.readdirSync(directory, { withFileTypes: true }).toSorted((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        const file = NodePath.join(directory, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (entry.isFile())
          hash
            .update(JSON.stringify(`${metadata.name}/${NodePath.relative(root, file)}`))
            .update("\0")
            .update(NodeFS.readFileSync(file))
            .update("\0");
      }
    };
    walk(root);
    for (const name of Object.keys({
      ...metadata.dependencies,
      ...metadata.optionalDependencies,
      ...metadata.peerDependencies,
    }).toSorted()) {
      const dependency = packageAt(root, name);
      if (dependency !== undefined) visit(dependency);
      else if (Object.hasOwn(metadata.dependencies ?? {}, name))
        throw new Error(`Missing guard dependency ${name}`);
    }
  };
  visit(manifest);
  return hash.digest("hex");
};

const moduleSpecifiers = (file: string, source: string) => {
  const parsed = parseSync(file, source);
  if (parsed.errors.length > 0) throw new Error(`Cannot hash guard imports in ${file}`);
  return {
    dynamic: parsed.module.dynamicImports.length > 0,
    static: [
      ...parsed.module.staticImports.map((item) => item.moduleRequest.value),
      ...parsed.module.staticExports.flatMap((item) =>
        item.entries.flatMap((entry) =>
          entry.moduleRequest === null ? [] : [entry.moduleRequest.value],
        ),
      ),
    ],
  };
};

export const hashGuardSource = (file: string): string =>
  NodeCrypto.createHash("sha256").update(NodeFS.readFileSync(file)).digest("hex");

const decodeObject = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown));
const decodePaths = Schema.decodeUnknownSync(
  Schema.Record(Schema.String, Schema.Array(Schema.String)),
);
const readJsonc = (file: string) =>
  decodeObject(
    JSON.parse(
      NodeFS.readFileSync(file, "utf8")
        .replace(
          /("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//gu,
          (match, quoted: string | undefined) => quoted ?? "",
        )
        .replace(
          /("(?:\\.|[^"\\])*")|,\s*([}\]])/gu,
          (match, quoted: string | undefined, ending: string | undefined) =>
            quoted ?? ending ?? match,
        ),
    ),
  );
const pickExport = (value: unknown): string | undefined => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = pickExport(item);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (value === null || typeof value !== "object") return undefined;
  const record = decodeObject(value);
  for (const key of ["import", "default", "require", "node", "types", ...Object.keys(record)]) {
    const found = pickExport(record[key]);
    if (found !== undefined) return found;
  }
  return undefined;
};
const matchPath = (pattern: string, value: string): string | undefined => {
  const star = pattern.indexOf("*");
  if (star === -1) return pattern === value ? "" : undefined;
  const start = pattern.slice(0, star),
    end = pattern.slice(star + 1);
  return value.startsWith(start) && value.endsWith(end)
    ? value.slice(start.length, value.length - end.length)
    : undefined;
};

/** The shadcn guards also read local imports, UI exports and theme/config files. Hash those
 * inputs without rescanning their ASTs for every consumer; imported source bytes are read once.
 */
export const makeGuardSourceHasher = (cwd: string, paths: ReadonlyArray<string>) => {
  const nodes = new Map<
    string,
    { readonly hash: string; readonly dependencies: ReadonlyArray<string> }
  >();
  const projects = new Map<
    string,
    {
      readonly root: string;
      readonly paths: ReadonlyArray<{
        readonly pattern: string;
        readonly base: string;
        readonly targets: ReadonlyArray<string>;
      }>;
    }
  >();
  const globalInputs = new Set<string>();

  const localFile = (candidate: string): string | undefined => {
    const extension = NodePath.extname(candidate);
    const swapped = {
      ".js": [".ts", ".tsx"],
      ".jsx": [".tsx"],
      ".mjs": [".mts", ".ts"],
      ".cjs": [".cts", ".ts"],
    };
    const alternatives = [
      candidate,
      ...(swapped[extension as keyof typeof swapped] ?? []).map(
        (suffix) => candidate.slice(0, -extension.length) + suffix,
      ),
      ...[".tsx", ".jsx", ".ts", ".js", ".mts", ".mjs", ".cts", ".cjs", ".json", ".css"].flatMap(
        (suffix) => [candidate + suffix, NodePath.join(candidate, `index${suffix}`)],
      ),
    ];
    return alternatives.find((file) => NodeFS.existsSync(file) && NodeFS.statSync(file).isFile());
  };
  const projectOf = (file: string) => {
    let root = NodePath.dirname(file);
    while (!NodeFS.existsSync(NodePath.join(root, "package.json"))) {
      if (root === cwd || root === NodePath.dirname(root)) break;
      root = NodePath.dirname(root);
    }
    const hit = projects.get(root);
    if (hit !== undefined) return hit;
    const aliases: Array<{ pattern: string; base: string; targets: ReadonlyArray<string> }> = [];
    const configs = new Set<string>();
    const readConfig = (filename: string) => {
      if (!NodeFS.existsSync(filename) || configs.has(filename)) return;
      configs.add(filename);
      globalInputs.add(filename);
      const config = readJsonc(filename);
      if (typeof config.extends === "string") {
        let parent: string | undefined;
        if (config.extends.startsWith("."))
          parent = localFile(NodePath.resolve(NodePath.dirname(filename), config.extends));
        else {
          try {
            parent = NodeModule.createRequire(filename).resolve(config.extends);
          } catch (error) {
            if (
              !(error instanceof Error) ||
              !("code" in error) ||
              error.code !== "MODULE_NOT_FOUND"
            )
              throw error;
          }
        }
        if (parent !== undefined) readConfig(parent);
      }
      if (config.compilerOptions !== undefined) {
        const compiler = decodeObject(config.compilerOptions);
        const base = NodePath.resolve(
          NodePath.dirname(filename),
          typeof compiler.baseUrl === "string" ? compiler.baseUrl : ".",
        );
        for (const [pattern, targets] of Object.entries(decodePaths(compiler.paths ?? {})))
          aliases.push({ pattern, base, targets });
      }
    };
    readConfig(NodePath.join(root, "tsconfig.json"));
    const project = { root, paths: aliases.toReversed() };
    projects.set(root, project);
    return project;
  };
  const resolve = (specifier: string, file: string, directory = false): string | undefined => {
    if (NodeModule.isBuiltin(specifier)) return undefined;
    const project = projectOf(file);
    const candidates: Array<string> = [];
    if (specifier.startsWith("."))
      candidates.push(NodePath.resolve(NodePath.dirname(file), specifier));
    else if (NodePath.isAbsolute(specifier)) candidates.push(specifier);
    else {
      for (const alias of project.paths) {
        const captured = matchPath(alias.pattern, specifier);
        if (captured !== undefined)
          candidates.push(
            ...alias.targets.map((target) =>
              NodePath.resolve(alias.base, target.replaceAll("*", captured)),
            ),
          );
      }
      if (/^[@~]\//u.test(specifier))
        candidates.push(
          NodePath.join(project.root, specifier.slice(2)),
          NodePath.join(project.root, "src", specifier.slice(2)),
        );
      else {
        const name = packageName(specifier);
        const manifest = packageAt(project.root, name) ?? packageAt(NodePath.dirname(file), name);
        if (manifest !== undefined) {
          globalInputs.add(manifest);
          const metadata = readJsonc(manifest);
          const subpath = specifier.slice(name.length);
          const exports =
            typeof metadata.exports === "string"
              ? { ".": metadata.exports }
              : decodeObject(metadata.exports ?? {});
          for (const key of Object.keys(exports).toSorted((a, b) => b.length - a.length)) {
            const captured = matchPath(key, subpath === "" ? "." : `.${subpath}`);
            const target = pickExport(exports[key]);
            if (captured !== undefined && target !== undefined)
              candidates.push(
                NodePath.resolve(NodePath.dirname(manifest), target.replaceAll("*", captured)),
              );
          }
          candidates.push(
            NodePath.join(
              NodePath.dirname(manifest),
              subpath ||
                (typeof metadata.module === "string"
                  ? metadata.module
                  : typeof metadata.main === "string"
                    ? metadata.main
                    : "index.js"),
            ),
          );
        }
      }
    }
    return candidates
      .map((candidate) =>
        directory && NodeFS.existsSync(candidate) && NodeFS.statSync(candidate).isDirectory()
          ? candidate
          : localFile(candidate),
      )
      .find((candidate) => candidate !== undefined);
  };
  const read = (file: string) => {
    if (nodes.has(file)) return;
    const source = NodeFS.readFileSync(file, "utf8");
    // The imported implementation may resolve a previously absent import. Keep the raw
    // specifier in the hash, and rebuild the graph on every run instead of caching resolution.
    const specifiers = /\.[cm]?[jt]sx?$/u.test(file)
      ? moduleSpecifiers(file, source).static
      : file.endsWith(".css")
        ? [...source.matchAll(/@(?:import|plugin|config)\s+["']([^"']+)["']/gu)].map(
            (match) => match[1]!,
          )
        : [];
    const dependencies = [
      ...new Set(
        specifiers.flatMap((specifier) => {
          const resolved = resolve(specifier, file);
          return resolved === undefined ? [] : [resolved];
        }),
      ),
    ];
    nodes.set(file, { hash: hashGuardSource(file), dependencies });
    for (const dependency of dependencies) read(dependency);
  };
  // Discovery/config and the implicit component index affect every file, even a file with no
  // imports. Include names as well as bytes so adding/removing an input invalidates the result.
  const uiRoots = [NodePath.join(cwd, "apps/web/src/components/ui")];
  const walkProject = (directory: string) => {
    for (const entry of NodeFS.readdirSync(directory, { withFileTypes: true })) {
      if (
        [
          "node_modules",
          ".git",
          "dist",
          "build",
          "out",
          "coverage",
          "public",
          ".next",
          ".turbo",
          ".registry",
        ].includes(entry.name) ||
        entry.name.startsWith(".")
      )
        continue;
      const file = NodePath.join(directory, entry.name);
      if (entry.isDirectory()) walkProject(file);
      else if (
        entry.isFile() &&
        (entry.name.endsWith(".css") ||
          ["package.json", "components.json", "tsconfig.json", "jsconfig.json"].includes(
            entry.name,
          ) ||
          uiRoots.some((root) => file.startsWith(`${root}${NodePath.sep}`)))
      )
        globalInputs.add(file);
    }
  };
  for (const path of paths) projectOf(NodePath.join(cwd, path));
  // Only web shadcn guards consult these project inputs in the current rule set.
  const webRoot = NodePath.join(cwd, "apps/web");
  if (NodeFS.existsSync(webRoot)) {
    walkProject(webRoot);
    for (const input of [...globalInputs].filter((file) => file.endsWith("/components.json"))) {
      const config = readJsonc(input);
      const aliases = decodeObject(config.aliases ?? {});
      const specifier =
        typeof aliases.ui === "string"
          ? aliases.ui
          : `${typeof aliases.components === "string" ? aliases.components : "@/components"}/ui`;
      const directory = resolve(specifier, input, true);
      if (directory !== undefined) {
        uiRoots.push(directory);
        walkProject(directory);
      }
    }
  }
  for (const path of paths) if (path.startsWith("apps/web/src/")) read(NodePath.join(cwd, path));
  for (const input of globalInputs) read(input);
  const identities = new Map(
    [...nodes.keys()].map((file) => [
      file,
      file.includes(`${NodePath.sep}node_modules${NodePath.sep}`)
        ? file.slice(file.indexOf(`${NodePath.sep}node_modules${NodePath.sep}`))
        : NodePath.relative(cwd, file),
    ]),
  );
  const identity = (file: string) => identities.get(file)!;
  // Import cycles share one dependency verdict. Collapse them once, then hash the DAG;
  // flattening every consumer's transitive graph repeats the same work thousands of times.
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: Array<string> = [];
  const onStack = new Set<string>();
  const components: Array<ReadonlyArray<string>> = [];
  const componentOf = new Map<string, number>();
  const connect = (file: string) => {
    const index = indices.size;
    indices.set(file, index);
    low.set(file, index);
    stack.push(file);
    onStack.add(file);
    for (const dependency of nodes.get(file)!.dependencies) {
      if (!indices.has(dependency)) {
        connect(dependency);
        low.set(file, Math.min(low.get(file)!, low.get(dependency)!));
      } else if (onStack.has(dependency))
        low.set(file, Math.min(low.get(file)!, indices.get(dependency)!));
    }
    if (low.get(file) === indices.get(file)) {
      const members: Array<string> = [];
      let member: string;
      do {
        member = stack.pop()!;
        onStack.delete(member);
        members.push(member);
        componentOf.set(member, components.length);
      } while (member !== file);
      components.push(members.toSorted((a, b) => identity(a).localeCompare(identity(b))));
    }
  };
  for (const file of nodes.keys()) if (!indices.has(file)) connect(file);
  const digests = new Map<number, string>();
  const componentHash = (id: number): string => {
    const hit = digests.get(id);
    if (hit !== undefined) return hit;
    const hash = NodeCrypto.createHash("sha256");
    const dependencies = new Set<number>();
    for (const file of components[id]!) {
      hash.update(JSON.stringify([identity(file), nodes.get(file)!.hash]));
      for (const dependency of nodes.get(file)!.dependencies) {
        const target = componentOf.get(dependency)!;
        if (target !== id) dependencies.add(target);
      }
    }
    hash.update(JSON.stringify([...dependencies].map(componentHash).toSorted()));
    const digest = hash.digest("hex");
    digests.set(id, digest);
    return digest;
  };
  const closureHash = (roots: ReadonlyArray<string>) =>
    NodeCrypto.createHash("sha256")
      .update(JSON.stringify(roots.map((file) => componentHash(componentOf.get(file)!)).toSorted()))
      .digest("hex");
  const projectHash = closureHash([...globalInputs]);
  return (path: string) =>
    path.startsWith("apps/web/src/")
      ? NodeCrypto.createHash("sha256")
          .update(projectHash)
          .update(closureHash([NodePath.join(cwd, path)]))
          .digest("hex")
      : hashGuardSource(NodePath.join(cwd, path));
};

/** Hash the local import closure and installed external implementations, not just rule names. */
export const hashGuardContext = (options: {
  readonly cwd: string;
  readonly config: string;
  readonly version: string;
  readonly ruleNames: ReadonlyArray<string>;
}): string => {
  const hash = NodeCrypto.createHash("sha256");
  const visited = new Set<string>();
  const add = (label: string, bytes: string | Uint8Array) => {
    hash.update(JSON.stringify(label)).update("\0").update(bytes).update("\0");
  };
  // Version the record/derivation format independently of the lint executable.
  add("guard-cache-v1", JSON.stringify([options.ruleNames, options.version, process.version]));
  add("effective-config", options.config.replaceAll(options.cwd, "<repo>"));
  const implementation = NodeURL.fileURLToPath(import.meta.url);
  add("cache-implementation", NodeFS.readFileSync(implementation));
  add(
    "driver-implementation",
    NodeFS.readFileSync(
      NodePath.join(NodePath.dirname(implementation), "../check-guard-exceptions.ts"),
    ),
  );

  const visitPackage = (manifest: string) => {
    if (visited.has(manifest)) return;
    visited.add(manifest);
    add("external-implementation", hashPackageTree(manifest));
  };

  const visitModule = (filename: string) => {
    const file = NodeFS.realpathSync(filename);
    if (visited.has(file)) return;
    visited.add(file);
    const source = NodeFS.readFileSync(file, "utf8");
    add(NodePath.relative(options.cwd, file), source);
    const specifiers = moduleSpecifiers(file, source);
    if (specifiers.dynamic) {
      throw new Error(`Guard cache cannot establish dynamic import closure in ${file}`);
    }
    for (const specifier of [...new Set(specifiers.static)].toSorted()) {
      if (NodeModule.isBuiltin(specifier)) continue;
      if (specifier.startsWith(".")) {
        visitModule(NodeModule.createRequire(file).resolve(specifier));
        continue;
      }
      const manifest = packageAt(NodePath.dirname(file), packageName(specifier));
      if (manifest === undefined) throw new Error(`Missing guard dependency ${specifier}`);
      if (manifest.includes(`${NodePath.sep}node_modules${NodePath.sep}`)) {
        visitPackage(manifest);
      } else {
        // Workspace packages can expose only an ESM import condition; require.resolve cannot
        // resolve those exports. Read their declared source, keeping unrelated workspace bytes out.
        const metadata = decodePackage(NodeFS.readFileSync(manifest, "utf8"));
        add(NodePath.relative(options.cwd, manifest), NodeFS.readFileSync(manifest));
        const subpath = specifier.slice(packageName(specifier).length);
        const exported = decodeExport(
          decodeObject(metadata.exports ?? {})[subpath === "" ? "." : `.${subpath}`],
        );
        const target = typeof exported === "string" ? exported : exported.import;
        visitModule(NodePath.resolve(NodePath.dirname(manifest), target));
      }
    }
  };
  const config = decodeConfig(options.config);
  if (config.options?.typeAware || config.options?.typeCheck) {
    throw new Error("Per-file guard caching requires AST-only lint configuration");
  }
  for (const plugin of config.jsPlugins ?? []) {
    if (typeof plugin !== "string") throw new Error("Unsupported guard plugin configuration");
    visitModule(NodePath.resolve(options.cwd, plugin));
  }
  return hash.digest("hex");
};

export const guardCacheKey = (context: string, path: string, content: string): string =>
  NodeCrypto.createHash("sha256")
    .update(JSON.stringify([context, path, content]))
    .digest("hex");

const recordDigest = (key: string, findings: ReadonlyArray<CachedGuardFinding>) =>
  NodeCrypto.createHash("sha256").update(JSON.stringify({ key, findings })).digest("hex");

export const readGuardCache = (
  directory: string,
  key: string,
  ruleNames: ReadonlyArray<string>,
): ReadonlyArray<CachedGuardFinding> | undefined => {
  const file = NodePath.join(directory, `${key}.json`);
  if (!NodeFS.existsSync(file)) return undefined;
  try {
    const record = decodeCachedFile(NodeFS.readFileSync(file, "utf8"));
    if (
      record.key !== key ||
      record.digest !== recordDigest(record.key, record.findings) ||
      record.findings.some((finding) => !ruleNames.includes(finding.ruleName))
    ) {
      return undefined;
    }
    return record.findings;
  } catch {
    // Damaged or obsolete records are misses, never evidence of zero findings.
    return undefined;
  }
};

export const writeGuardCache = (
  directory: string,
  key: string,
  findings: ReadonlyArray<CachedGuardFinding>,
): void => {
  NodeFS.mkdirSync(directory, { recursive: true });
  const temporary = NodePath.join(directory, `${key}.${NodeCrypto.randomUUID()}.tmp`);
  try {
    NodeFS.writeFileSync(
      temporary,
      JSON.stringify({ key, findings, digest: recordDigest(key, findings) }),
      { flag: "wx" },
    );
    NodeFS.renameSync(temporary, NodePath.join(directory, `${key}.json`));
  } finally {
    NodeFS.rmSync(temporary, { force: true });
  }
};
