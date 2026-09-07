import { VcsProcessExitError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type {
  VcsCheckpointOps,
  VcsDriver,
  VcsCaptureSnapshotInput,
  VcsResolveSnapshotInput,
} from "./VcsDriver.ts";

export const SNAPSHOT_POLICY = {
  maxPaths: 10_000,
  maxPathBytes: 1_048_576,
  maxFileBytes: 8_388_608,
  maxTotalBytes: 67_108_864,
} as const;

// The alias executes on the repository's machine. All temporary files, validation,
// content reads and cleanup share that boundary, including when Git runs over SSH.
// Paths stay NUL-delimited; only the validated file list reaches hash-object.
export const SNAPSHOT_SCRIPT = String.raw`f() {
set -eu
export LC_ALL=C GIT_NO_LAZY_FETCH=1 GIT_TERMINAL_PROMPT=0 GIT_NO_REPLACE_OBJECTS=1
unset GIT_INDEX_FILE
mode=$1; ref=$2; max_paths=$3; max_names=$4; max_file=$5; max_total=$6; baseline=$7; expected=$8
fail() { printf 'Snapshot refused: %s\n' "$*" >&2; exit 1; }
case "$ref" in refs/t3/checkpoints/*/runs/*/before|refs/t3/checkpoints/*/runs/*/after) ;; *) fail 'ref is outside the owned run namespace';; esac
git check-ref-format "$ref" || fail 'invalid checkpoint ref'
[ "$(git rev-parse --is-inside-work-tree)" = true ] || fail 'not a working repository'
[ -d .git ] && [ ! -L .git ] || fail 'unsupported Git layout'
[ -z "$GIT_PREFIX" ] || fail 'snapshot requires repository root'
[ -z "$(git rev-parse --show-prefix)" ] || fail 'snapshot requires repository root'
if git config --get extensions.partialClone >/dev/null 2>&1 || git config --get-regexp 'remote\..*\.promisor' >/dev/null 2>&1; then fail 'unsupported partial clone'; fi
scratch=$(mktemp -d .git/mate-snapshot-XXXXXXXX)
trap 'rm -rf -- "$scratch"' EXIT
trap 'exit 1' HUP INT TERM
check_objects() {
  [ "$(git show -s --format=%P "$1")" = '' ] || fail 'checkpoint is not a parentless snapshot'
  [ "$(git show -s --format=%B "$1")" = "Mate snapshot $ref" ] || fail 'checkpoint ref does not contain the expected run snapshot'
  git rev-list --objects --no-object-names --missing=print "$1" > "$scratch/objects" || fail 'snapshot objects unreadable'
  if grep -q '^?' "$scratch/objects"; then fail 'snapshot objects missing'; fi
}
if [ "$mode" = resolve ] && [ -n "$expected" ]; then
  existing=$(git rev-parse --verify --quiet "$expected^{commit}" || true)
else
  existing=$(git rev-parse --verify --quiet "$ref^{commit}" || true)
fi
if [ -n "$existing" ]; then
  check_objects "$existing"
  printf '%s\nreused\n' "$existing"
  return
fi
if [ "$mode" = resolve ]; then printf 'absent\n'; return; fi
if git show-ref --verify --quiet "$ref"; then fail 'existing checkpoint ref is not a commit'; fi
bounded_list() {
  (set +e; "$@"; printf '%s\n' "$?" > "$scratch/status") | head -c "$((max_names + 1))" > "$scratch/part"
  [ "$(wc -c < "$scratch/part")" -le "$max_names" ] || fail 'candidate path byte limit exceeded'
  [ "$(cat "$scratch/status")" = 0 ] || fail 'candidate enumeration failed'
}
bounded_list git ls-files -z --cached --others --exclude-standard
cat "$scratch/part" > "$scratch/all"
if git rev-parse --verify --quiet HEAD >/dev/null; then
  bounded_list git ls-tree -r -z --name-only HEAD
  cat "$scratch/part" >> "$scratch/all"
fi
sort -zu "$scratch/all" > "$scratch/paths"
[ "$(wc -c < "$scratch/paths")" -le "$max_names" ] || fail 'candidate path byte limit exceeded'
[ "$(tr -cd '\000' < "$scratch/paths" | wc -c)" -le "$max_paths" ] || fail 'candidate file limit exceeded'
if [ -n "$baseline" ]; then
  bounded_list git ls-tree -r -z --name-only "$baseline"
  set +e
  git check-ignore -z --stdin < "$scratch/part" > "$scratch/ignored"
  ignore_status=$?
  set -e
  [ "$ignore_status" -le 1 ] || fail 'cannot inspect baseline ignore rules'
  if [ -s "$scratch/ignored" ]; then
    xargs -0 sh -c 'for p do if [ -e "$p" ] || [ -L "$p" ]; then printf "Snapshot refused: selection rules changed for existing baseline file: %s\n" "$p" >&2; exit 1; fi; done' sh < "$scratch/ignored" || fail 'selection rules changed'
  fi
fi
: > "$scratch/sizes"
: > "$scratch/present"
cat > "$scratch/inspect" <<'MATE_INSPECT'
set -eu
scratch=$1; max_file=$2; shift 2
for p do
  case "$p" in ''|/*|../*|*/../*|*/..|./*|*/./*|.git|.git/*) printf 'Snapshot refused: unsupported path\n' >&2; exit 1;; esac
  case "/$p/" in */node_modules/*|*/.venv/*|*/venv/*|*/__pycache__/*|*/.next/*|*/.nuxt/*|*/.svelte-kit/*|*/.turbo/*|*/.cache/*)
    printf 'Snapshot refused: dependency or generated content: %s\n' "$p" >&2; exit 1;; esac
  parent=./$p
  while :; do
    [ ! -L "$parent" ] || { printf 'Snapshot refused: unsupported symlink: %s\n' "$p" >&2; exit 1; }
    case "$parent" in */*) parent=$(dirname "$parent");; *) break;; esac
  done
  if [ ! -e "$p" ]; then continue; fi
  [ -f "$p" ] || { printf 'Snapshot refused: unsupported nested repository or special file: %s\n' "$p" >&2; exit 1; }
  size=$(stat -c %s -- "./$p" 2>/dev/null || stat -f %z "./$p")
  [ "$size" -le "$max_file" ] || { printf 'Snapshot refused: file byte limit: %s\n' "$p" >&2; exit 1; }
  printf '%s\n' "$size" >> "$scratch/sizes"
  printf '%s\0' "$p" >> "$scratch/present"
done
MATE_INSPECT
if [ -s "$scratch/paths" ]; then xargs -0 sh "$scratch/inspect" "$scratch" "$max_file" < "$scratch/paths" || fail 'candidate validation failed'; fi
total=$(awk '{s += $1} END {printf "%.0f", s}' "$scratch/sizes")
[ "$total" -le "$max_total" ] || fail 'total input byte limit exceeded'
git check-attr -z --stdin filter working-tree-encoding < "$scratch/present" > "$scratch/attrs"
if [ -s "$scratch/attrs" ]; then
  xargs -0 -n 3 sh -c '[ "$3" = unspecified ] || [ "$3" = unset ] || { printf "Snapshot refused: unsupported filter or encoding: %s\n" "$1" >&2; exit 1; }' sh < "$scratch/attrs" || fail 'unsupported content attributes'
fi
export GIT_INDEX_FILE="$PWD/$scratch/index"
export GIT_AUTHOR_NAME='Mate' GIT_AUTHOR_EMAIL='mate@zerops.io' GIT_COMMITTER_NAME='Mate' GIT_COMMITTER_EMAIL='mate@zerops.io'
git read-tree --empty
: > "$scratch/index-info"
printf '0\n' > "$scratch/total"
cat > "$scratch/capture" <<'MATE_CAPTURE'
set -eu
scratch=$1; max_file=$2; max_total=$3; shift 3
for p do
  [ -f "$p" ] && [ ! -L "$p" ] || { printf 'Snapshot refused: candidate changed type: %s\n' "$p" >&2; exit 1; }
  head -c "$((max_file + 1))" < "$p" > "$scratch/content"
  size=$(wc -c < "$scratch/content")
  [ "$size" -le "$max_file" ] || { printf 'Snapshot refused: file grew past byte limit: %s\n' "$p" >&2; exit 1; }
  total=$(cat "$scratch/total"); total=$((total + size))
  [ "$total" -le "$max_total" ] || { printf 'Snapshot refused: total input byte limit exceeded\n' >&2; exit 1; }
  printf '%s\n' "$total" > "$scratch/total"
  oid=$(git hash-object -w --stdin --path="$p" < "$scratch/content")
  mode=100644; if [ -x "$p" ]; then mode=100755; fi
  printf '%s %s\t%s\0' "$mode" "$oid" "$p" >> "$scratch/index-info"
done
MATE_CAPTURE
if [ -s "$scratch/present" ]; then xargs -0 sh "$scratch/capture" "$scratch" "$max_file" "$max_total" < "$scratch/present" || fail 'content capture failed'; fi
git update-index -z --index-info < "$scratch/index-info"
tree=$(git write-tree)
oid=$(printf 'Mate snapshot %s\n' "$ref" | git commit-tree "$tree")
zero=$(printf '%s' "$oid" | tr '0123456789abcdef' '0')
result=captured
if ! git update-ref "$ref" "$oid" "$zero" 2> "$scratch/ref-error"; then
  oid=$(git rev-parse --verify --quiet "$ref^{commit}") || fail 'cannot protect snapshot ref'
  result=reused
fi
check_objects "$oid"
printf '%s\n%s\n' "$oid" "$result"
}; f`;

export function makeSnapshotOperations(
  execute: VcsDriver["Service"]["execute"],
): Pick<VcsCheckpointOps, "captureSnapshot" | "resolveSnapshot"> {
  const run = Effect.fn("GitVcsDriver.snapshot")(function* (
    mode: "capture" | "resolve",
    input: VcsCaptureSnapshotInput & VcsResolveSnapshotInput,
  ) {
    const policy = { ...SNAPSHOT_POLICY, ...input.policy };
    for (const oid of [input.baselineOid, input.expectedOid]) {
      if (oid !== undefined && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(oid)) {
        return yield* new VcsProcessExitError({
          operation: "GitVcsDriver.snapshot",
          command: "git mate-snapshot",
          cwd: input.cwd,
          exitCode: 1,
          detail: "Invalid snapshot object identity.",
        });
      }
    }
    for (const key of Object.keys(SNAPSHOT_POLICY) as Array<keyof typeof SNAPSHOT_POLICY>) {
      const value = policy[key];
      if (!Number.isSafeInteger(value) || value < 1 || value > SNAPSHOT_POLICY[key]) {
        return yield* new VcsProcessExitError({
          operation: "GitVcsDriver.snapshot",
          command: "git mate-snapshot",
          cwd: input.cwd,
          exitCode: 1,
          detail: "Invalid snapshot input limit.",
        });
      }
    }
    const result = yield* execute({
      operation: "GitVcsDriver.snapshot",
      cwd: input.cwd,
      args: [
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.untrackedCache=false",
        "-c",
        `alias.mate-snapshot=!${SNAPSHOT_SCRIPT}`,
        "mate-snapshot",
        mode,
        input.checkpointRef,
        String(policy.maxPaths),
        String(policy.maxPathBytes),
        String(policy.maxFileBytes),
        String(policy.maxTotalBytes),
        input.baselineOid ?? "",
        input.expectedOid ?? "",
      ],
      timeoutMs: 35_000,
      maxOutputBytes: 8192,
      allowNonZeroExit: true,
    });
    if (result.exitCode !== 0) {
      return yield* new VcsProcessExitError({
        operation: "GitVcsDriver.snapshot",
        command: "git mate-snapshot",
        cwd: input.cwd,
        exitCode: result.exitCode,
        detail: result.stderr.trim() || "Snapshot operation failed.",
      });
    }
    const [oid, state] = result.stdout.trim().split("\n");
    if (mode === "resolve" && oid === "absent") return null;
    if (
      !oid ||
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(oid) ||
      (state !== "reused" && state !== "captured")
    ) {
      return yield* new VcsProcessExitError({
        operation: "GitVcsDriver.snapshot",
        command: "git mate-snapshot",
        cwd: input.cwd,
        exitCode: 1,
        detail: "Invalid snapshot receipt.",
      });
    }
    return {
      oid,
      representation: "git-normalized" as const,
      policyVersion: "git-v1" as const,
      reused: state === "reused",
    };
  });
  return {
    captureSnapshot: (input) =>
      run("capture", input).pipe(
        Effect.flatMap((result) =>
          result === null ? Effect.die("Capture returned no snapshot") : Effect.succeed(result),
        ),
      ),
    resolveSnapshot: (input) =>
      run("resolve", input).pipe(Effect.map((result) => result?.oid ?? null)),
  };
}
