// @effect-diagnostics nodeBuiltinImport:off -- CI selection reads its committed probe manifest.
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
  const stateSmokeShards = narrowed
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

if (
  process.argv[1] &&
  NodePath.resolve(process.argv[1]) === NodeURL.fileURLToPath(import.meta.url)
) {
  const path = ".ci-blame-jobs";
  const manifest = NodeFS.existsSync(path) ? NodeFS.readFileSync(path, "utf8") : undefined;
  const selection = blameSelection(process.env.GITHUB_REF ?? "", manifest);
  const outputs = [
    `jobs=${JSON.stringify(selection.selected)}`,
    `blame=${selection.narrowed}`,
    `state_smoke_shards=${JSON.stringify(selection.stateSmokeShards)}`,
  ];
  for (const [job, matrix] of Object.entries(selection.matrices))
    outputs.push(`${job}=${JSON.stringify(matrix)}`);
  NodeFS.appendFileSync(process.env.GITHUB_OUTPUT!, outputs.join("\n") + "\n");
}
