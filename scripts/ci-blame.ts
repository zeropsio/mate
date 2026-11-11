// @effect-diagnostics nodeBuiltinImport:off globalConsole:off -- CI selection reports its committed decisions.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

// Full partition sizes stay fixed when a blame run selects only one shard.
export const blameMatrices = {
  test_scripts: [1].map((shard) => ({ shard, total: 1 })),
  test_client_runtime: [1].map((shard) => ({ shard, total: 1 })),
  test_web: [1, 2, 3].map((shard) => ({ shard, total: 3 })),
  test_server: [1, 2, 3].map((shard) => ({ shard, total: 3 })),
};
const jobNames = {
  check: "Check",
  check_guards: "Check Guards",
  check_types: "Check Types",
  check_build: "Check Build",
  state_smoke: "State Smoke",
  test: "Test",
  test_packages: "Test Packages",
  test_scripts: "Test Scripts",
  test_client_runtime: "Test Client Runtime",
  test_web: "Test Web",
  test_server: "Test Server",
  changes: "Changes",
  release_smoke: "Release Smoke",
  test_mobile: "Test Mobile",
  mobile_native_static_analysis: "Mobile Native Static Analysis",
};
export const checkJobIds = ["check", "check_guards", "check_types", "check_build"] as const;
// Test suites run only when someone asks for them: a manual dispatch or a kh-bisect manifest.
const testJobIds = new Set([
  "state_smoke",
  "test",
  "test_packages",
  "test_scripts",
  "test_client_runtime",
  "test_web",
  "test_server",
  "test_mobile",
]);
type MatrixJob = keyof typeof blameMatrices;
const stateSmokeContext = /^State Smoke ([1-9]\d*)$/u;

/** State Smoke's shard count follows its scenario selection; blame keeps the requested shards of it. */
export function stateSmokeMatrix(total: number, requested: "all" | ReadonlyArray<number>) {
  const missing = requested === "all" ? [] : requested.filter((shard) => shard > total);
  if (missing.length)
    throw new Error(`State Smoke ${missing.join(", ")} does not exist: this commit has ${total}`);
  return {
    include: Array.from({ length: total }, (_, index) => ({ shard: index + 1, total })).filter(
      ({ shard }) => requested === "all" || requested.includes(shard),
    ),
  };
}

export function blameSelection(ref: string, manifest: string | undefined) {
  const bisect = ref.startsWith("refs/heads/kh-bisect/");
  if (bisect && manifest === undefined) {
    throw new Error(
      "kh-bisect needs .ci-blame-jobs at the repository root, committed normally (git add, git commit; no --no-verify). " +
        'One job per line: a name such as "Test Web 1", the word "all" for every job, or an empty file for none.',
    );
  }
  const requested = new Set(
    manifest
      ?.split(/\r?\n/u)
      .map((name) => name.trim())
      .filter(Boolean),
  );
  const narrowed = bisect && !requested.has("all");
  const selected = new Set<string>();
  const matrices: Record<string, { include: Record<string, string | number>[] }> = {};
  for (const [job, name] of Object.entries(jobNames)) {
    if (!narrowed || requested.has(name)) selected.add(job);
  }
  const bundleFailed = requested.has(`${jobNames.state_smoke} bundle`);
  if (bundleFailed) selected.add("state_smoke");
  const stateSmokeShards =
    narrowed && !bundleFailed
      ? [...requested].flatMap((name) => {
          const shard = stateSmokeContext.exec(name)?.[1];
          return shard ? [Number(shard)] : [];
        })
      : ("all" as const);
  if (stateSmokeShards !== "all" && stateSmokeShards.length) selected.add("state_smoke");
  for (const [job, rows] of Object.entries(blameMatrices)) {
    const name = jobNames[job as MatrixJob];
    const include = rows.filter((row) => {
      const context = `${name} ${row.shard}`;
      return !narrowed || requested.has(context);
    });
    matrices[job] = { include };
    if (include.length) selected.add(job);
  }
  if (narrowed) {
    // These are execution dependencies or summary contexts, not extra test suites.
    if (
      selected.has("test") &&
      !["test_packages", "test_scripts", "test_client_runtime"].some((job) => selected.has(job))
    ) {
      for (const job of ["test_packages", "test_scripts", "test_client_runtime"]) {
        selected.add(job);
        if (job in blameMatrices) matrices[job] = { include: blameMatrices[job as MatrixJob] };
      }
    }
    if (selected.has("release_smoke")) {
      for (const job of checkJobIds) selected.add(job);
    }
    if (selected.has("state_smoke") || checkJobIds.some((job) => selected.has(job))) {
      selected.add("changes");
    }
    if (requested.size && !selected.size)
      throw new Error("No known failed CI job in .ci-blame-jobs");
  }
  return { narrowed, selected: [...selected], matrices, stateSmokeShards };
}

/** The CI decisions travel together; later selection steps add their own input and decisions. */
export function ciSelectionManifest(
  ref: string,
  candidate: string | undefined,
  manifest: string | undefined,
  event: string,
) {
  const selection = blameSelection(ref, manifest);
  const testsRequested = event === "workflow_dispatch" || ref.startsWith("refs/heads/kh-bisect/");
  return {
    version: 1 as const,
    context: "ci" as const,
    candidate: candidate || null,
    ref,
    jobs: testsRequested
      ? selection.selected
      : selection.selected.filter((job) => !testJobIds.has(job)),
    blame: selection.narrowed,
    matrices: selection.matrices,
    stateSmokeShards: selection.stateSmokeShards,
  };
}

export type CiSelectionManifest = ReturnType<typeof ciSelectionManifest>;

// The local gate caps related scenarios; blocking CI selects the complete affected set.
export const relatedScenarioLimit = 8;
export const browserPath = (path: string) => !/^apps\/(?:mobile|desktop)(?:\/|$)/u.test(path);

export function scenarioSelectionManifest(
  context: "gate" | "state-smoke",
  graph: {
    scenarios: ReadonlyArray<string>;
    related?:
      | { rank(paths: ReadonlyArray<string>): { file: string; distance: number }[] }
      | undefined;
  },
  paths: ReadonlyArray<string>,
  existing: ReadonlyArray<string>,
  namedScenarios: ReadonlyArray<string>,
) {
  const scenarioPaths = paths.filter(browserPath);
  const explicit = new Set([
    ...namedScenarios,
    ...scenarioPaths.filter((file) => file.endsWith(".scenario.ts") && existing.includes(file)),
  ]);
  const ranked =
    graph.related
      ?.rank(scenarioPaths)
      .filter(({ file }) => graph.scenarios.includes(file) && !explicit.has(file)) ?? [];
  const limit = context === "gate" ? relatedScenarioLimit : Infinity;
  const selectedScenarios = ranked.slice(0, limit);
  return {
    version: 1 as const,
    context,
    selectedScenarios,
    overflowScenarios: ranked.slice(limit),
    inventory: [...new Set([...explicit, ...selectedScenarios.map(({ file }) => file)])].sort(),
  };
}

export function parseCiSelectionManifest(value: string, candidate?: string): CiSelectionManifest {
  const manifest: unknown = JSON.parse(value);
  if (
    !manifest ||
    typeof manifest !== "object" ||
    !("version" in manifest && manifest.version === 1) ||
    !("context" in manifest && manifest.context === "ci") ||
    !("ref" in manifest && typeof manifest.ref === "string") ||
    !(
      "candidate" in manifest &&
      (typeof manifest.candidate === "string" || manifest.candidate === null)
    ) ||
    (candidate !== undefined && manifest.candidate !== candidate) ||
    !(
      "jobs" in manifest &&
      Array.isArray(manifest.jobs) &&
      manifest.jobs.every((job) => typeof job === "string")
    ) ||
    !("blame" in manifest && typeof manifest.blame === "boolean") ||
    !(
      "matrices" in manifest &&
      typeof manifest.matrices === "object" &&
      manifest.matrices !== null
    ) ||
    !(
      "stateSmokeShards" in manifest &&
      (manifest.stateSmokeShards === "all" ||
        (Array.isArray(manifest.stateSmokeShards) &&
          manifest.stateSmokeShards.every((shard) => Number.isInteger(shard) && shard > 0)))
    )
  )
    throw new Error("Invalid or mismatched CI selection manifest");
  return manifest as CiSelectionManifest;
}

/** CI's native jobs follow the apps' actual workspace dependencies, including renamed paths. */
export function ciChangedAreas(root: string, paths: ReadonlyArray<string>, pullRequest: boolean) {
  const readPackage = (path: string) =>
    JSON.parse(NodeFS.readFileSync(NodePath.join(root, path, "package.json"), "utf8")) as {
      name?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
  const imports = new Set(
    ["apps/mobile", "apps/desktop"].flatMap((path) => {
      const pkg = readPackage(path);
      return Object.keys({
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.optionalDependencies,
      });
    }),
  );
  const nativePackages = NodeFS.globSync("packages/*/package.json", { cwd: root })
    .map((path) => path.slice(0, -"/package.json".length))
    .filter((path) => imports.has(readPackage(path).name ?? ""));
  const shared =
    /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.base\.json|vite\.config\.ts|\.github\/workflows\/ci\.yml)$|^packages\/(?:contracts|shared|client-runtime)\//u;
  return {
    chat: paths.some(
      (path) =>
        shared.test(path) ||
        /^apps\/(?:server|web)\//u.test(path) ||
        /^packages\/(?:effect-codex-app-server|effect-acp)\//u.test(path) ||
        /^scripts\/(?:chat-gate|gate-changed|test-postgres|test-ports)/u.test(path),
    ),
    resource_monitor:
      !pullRequest ||
      paths.some((path) =>
        /^native\/resource-monitor\/|^\.github\/workflows\/ci\.yml$/u.test(path),
      ),
    native_clients: paths.some(
      (path) =>
        /^apps\/(?:mobile|desktop)\//u.test(path) ||
        nativePackages.some((pkg) => path.startsWith(`${pkg}/`)),
    ),
  };
}

if (
  process.argv[1] &&
  NodePath.resolve(process.argv[1]) === NodeURL.fileURLToPath(import.meta.url)
) {
  if (process.argv[2] === "--areas") {
    const selection = parseCiSelectionManifest(
      process.env.MATE_CI_SELECTION ?? "",
      process.env.GITHUB_SHA,
    );
    const paths = NodeFS.readFileSync(0, "utf8").split("\n").filter(Boolean);
    const changes = ciChangedAreas(process.cwd(), paths, Boolean(process.env.PR_NUMBER));
    const manifest = { ...selection, paths, changes };
    const outputs = Object.entries(changes).map(([area, selected]) => `${area}=${selected}`);
    console.log(`CI selection: ${JSON.stringify(manifest)}`);
    NodeFS.appendFileSync(process.env.GITHUB_OUTPUT!, outputs.join("\n") + "\n");
  } else {
    const path = ".ci-blame-jobs";
    const manifest = NodeFS.existsSync(path) ? NodeFS.readFileSync(path, "utf8") : undefined;
    const selection = ciSelectionManifest(
      process.env.GITHUB_REF ?? "",
      process.env.GITHUB_SHA,
      manifest,
      process.env.GITHUB_EVENT_NAME ?? "",
    );
    const outputs = [
      `selection_manifest=${JSON.stringify(selection)}`,
      `jobs=${JSON.stringify(selection.jobs)}`,
      `blame=${selection.blame}`,
      `state_smoke_shards=${JSON.stringify(selection.stateSmokeShards)}`,
    ];
    for (const [job, matrix] of Object.entries(selection.matrices))
      outputs.push(`${job}=${JSON.stringify(matrix)}`);
    NodeFS.appendFileSync(process.env.GITHUB_OUTPUT!, outputs.join("\n") + "\n");
  }
}
