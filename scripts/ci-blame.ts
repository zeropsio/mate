// @effect-diagnostics nodeBuiltinImport:off -- CI selection reads its committed probe manifest.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

// Full partition sizes stay fixed when a blame run selects only one shard.
export const blameMatrices = {
  test_scripts: [1].map((shard) => ({ shard, total: 1 })),
  test_hq: [1].map((shard) => ({ shard, total: 1 })),
  test_web: [1, 2].map((shard) => ({ shard, total: 2 })),
  test_server: [1, 2, 3, 4].map((shard) => ({ shard, total: 4 })),
};
const jobNames = {
  check: "Check",
  check_guards: "Check Guards",
  check_types: "Check Types",
  check_build: "Check Build",
  chat_bundle: "Chat Contract bundle",
  state_smoke: "State Smoke",
  test: "Test",
  test_packages: "Test Packages",
  test_scripts: "Test Scripts",
  test_hq: "Test HQ",
  test_web: "Test Web",
  test_server: "Test Server",
  changes: "Changes",
  release_smoke: "Release Smoke",
  test_mobile: "Test Mobile",
  mobile_native_static_analysis: "Mobile Native Static Analysis",
};
export const checkJobIds = ["check", "check_guards", "check_types", "check_build"] as const;
type MatrixJob = keyof typeof blameMatrices;

export function blameSelection(ref: string, manifest: string | undefined) {
  const narrowed = ref.startsWith("refs/heads/kh-bisect/") && manifest !== undefined;
  const requested = new Set(
    manifest
      ?.split(/\r?\n/u)
      .map((name) => name.trim())
      .filter(Boolean),
  );
  const selected = new Set<string>();
  const matrices: Record<string, { include: Record<string, string | number>[] }> = {};
  for (const [job, name] of Object.entries(jobNames)) {
    if (!narrowed || requested.has(name)) selected.add(job);
  }
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
      !["test_packages", "test_scripts", "test_hq"].some((job) => selected.has(job))
    ) {
      for (const job of ["test_packages", "test_scripts", "test_hq"]) {
        selected.add(job);
        if (job in blameMatrices) matrices[job] = { include: blameMatrices[job as MatrixJob] };
      }
    }
    if (selected.has("release_smoke")) {
      for (const job of checkJobIds) selected.add(job);
    }
    if (selected.has("state_smoke")) selected.add("chat_bundle");
    if (selected.has("chat_bundle") || checkJobIds.some((job) => selected.has(job))) {
      selected.add("changes");
    }
    if (!selected.size) throw new Error("No known failed CI job in .ci-blame-jobs");
  }
  return { narrowed, selected: [...selected], matrices };
}

if (
  process.argv[1] &&
  NodePath.resolve(process.argv[1]) === NodeURL.fileURLToPath(import.meta.url)
) {
  const path = ".ci-blame-jobs";
  const manifest = NodeFS.existsSync(path) ? NodeFS.readFileSync(path, "utf8") : undefined;
  const selection = blameSelection(process.env.GITHUB_REF ?? "", manifest);
  const outputs = [`jobs=${JSON.stringify(selection.selected)}`, `blame=${selection.narrowed}`];
  for (const [job, matrix] of Object.entries(selection.matrices))
    outputs.push(`${job}=${JSON.stringify(matrix)}`);
  NodeFS.appendFileSync(process.env.GITHUB_OUTPUT!, outputs.join("\n") + "\n");
}
