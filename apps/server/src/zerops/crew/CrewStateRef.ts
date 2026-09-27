/**
 * CrewStateRef - the crew's state mirrored onto the dev service, so it
 * survives what `~/.t3` does not (a zcp@1 redeploy).
 *
 * `refs/t3/crew-state/<crew>` points at a parentless commit whose tree holds
 * `seq` (`"<N>\n"`) beside the files the engine hands over: `crew.yaml`,
 * `brief.md`, `jobs/<handle>.md`, `memory/<handle>/...`, `board.json`
 * (ARCHITECTURE §4). Each change bumps `crew_definition.seq`; a flush writes
 * the whole tree in one ssh command and records `flushed_seq`.
 *
 * **Write protocol.** The files travel on stdin, one line each: the base64 of
 * the path and of the content (the process runner carries text, and base64
 * keeps any byte and any newline out of the framing). The far side writes the
 * blobs with `hash-object -w`, builds the tree in a private index under
 * `mktemp` - nothing touches the working tree or the person's index - and
 * commits it with the crew identity and the durable-write settings. The ref
 * moves by compare-and-swap (`update-ref <ref> <new> <old>`); a ref already
 * holding a seq at least as high wins, so the higher seq always survives a
 * race.
 *
 * @module CrewStateRef
 */
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { shellQuote } from "../ZeropsWorkspaceAccess.ts";
import {
  CrewShell,
  field,
  fieldsOf,
  git,
  runFields,
  shellVariable,
  type CrewGitError,
  type CrewShellError,
} from "./CrewShell.ts";
import { CrewStore, type CrewStoreError } from "./CrewStore.ts";

export interface CrewStateFile {
  /** Relative, `/`-separated segments of `[A-Za-z0-9._-]`; never `seq`. */
  readonly path: string;
  readonly content: string;
}

export interface CrewState {
  readonly seq: number;
  readonly files: ReadonlyArray<CrewStateFile>;
}

export type FlushOutcome =
  | { readonly _tag: "written"; readonly commit: string }
  /** The ref already holds `seq` or higher; nothing was written. */
  | { readonly _tag: "superseded"; readonly seq: number };

/** A file path the state tree cannot carry. */
export class CrewStatePathError extends Schema.TaggedError<CrewStatePathError>()(
  "CrewStatePathError",
  { path: Schema.String },
) {
  override get message(): string {
    return `'${this.path}' cannot be a crew-state path`;
  }
}

export type CrewStateRefError = CrewShellError | CrewGitError | CrewStoreError | CrewStatePathError;

export interface CrewStateRefService {
  readonly flush: (input: {
    readonly crew: string;
    readonly host: string;
    readonly seq: number;
    readonly files: ReadonlyArray<CrewStateFile>;
  }) => Effect.Effect<FlushOutcome, CrewStateRefError>;
  readonly read: (
    crew: string,
    host: string,
  ) => Effect.Effect<Option.Option<CrewState>, CrewStateRefError>;
}

export class CrewStateRef extends Context.Service<CrewStateRef, CrewStateRefService>()(
  "t3/zerops/crew/CrewStateRef",
) {}

export const crewStateRef = (crew: string): string => `refs/t3/crew-state/${crew}`;

const SEQ_PATH = "seq";
const PATH_SEGMENT = /^[A-Za-z0-9._-]+$/;

const isStatePath = (path: string): boolean =>
  path !== SEQ_PATH &&
  path
    .split("/")
    .every((segment) => PATH_SEGMENT.test(segment) && segment !== "." && segment !== "..");

/** How many times a flush re-reads the ref after losing a compare-and-swap. */
const CAS_ATTEMPTS = 3;

const STATE_SCRIPT_TIMEOUT = Duration.minutes(1);

const base64 = (text: string): string => Buffer.from(text, "utf8").toString("base64");
const fromBase64 = (text: string): string => Buffer.from(text, "base64").toString("utf8");

export const make = Effect.gen(function* () {
  const shell = yield* CrewShell;
  const store = yield* CrewStore;

  const flush: CrewStateRefService["flush"] = ({ crew, host, seq, files }) =>
    Effect.gen(function* () {
      const invalid = files.find((file) => !isStatePath(file.path));
      if (invalid !== undefined) return yield* new CrewStatePathError({ path: invalid.path });
      const ref = crewStateRef(crew);
      const stdin = [...files, { path: SEQ_PATH, content: `${seq}\n` }]
        .map((file) => `${base64(file.path)} ${base64(file.content)}\n`)
        .join("");
      const out = yield* runFields(
        shell,
        host,
        "flushCrewState",
        `index=$(mktemp) || exit 1\n` +
          `rm -f "$index"\n` +
          `trap 'rm -f "$index"' EXIT\n` +
          `while read -r path content; do\n` +
          `  path=$(printf '%s' "$path" | base64 -d) || exit 1\n` +
          `  blob=$(printf '%s' "$content" | base64 -d | ${git("integration", ["hash-object", "-w", "--stdin"])}) || exit 1\n` +
          `  GIT_INDEX_FILE="$index" ${git("integration", ["update-index", "--add", "--cacheinfo", "100644", shellVariable("blob"), shellVariable("path")])} || exit 1\n` +
          `done\n` +
          `tree=$(GIT_INDEX_FILE="$index" ${git("integration", ["write-tree"])}) || exit 1\n` +
          `attempt=0\n` +
          `while :; do\n` +
          `  old=$(${git("integration", ["rev-parse", "-q", "--verify", ref])}) || old=\n` +
          `  if [ -n "$old" ]; then\n` +
          `    oldSeq="$old:${SEQ_PATH}"\n` +
          `    theirs=$(${git("integration", ["cat-file", "blob", shellVariable("oldSeq")])} 2>/dev/null) || theirs=0\n` +
          `    if [ "$theirs" -ge ${seq} ]; then printf 'status\\tsuperseded\\nseq\\t%s\\n' "$theirs"; exit 0; fi\n` +
          `  fi\n` +
          `  commit=$(printf 'crew-state %s seq %s\\n' ${shellQuote(crew)} ${seq} | ${git("integration", ["commit-tree", shellVariable("tree")])}) || exit 1\n` +
          `  if ${git("integration", ["update-ref", ref, shellVariable("commit"), shellVariable("old")])} 2>/dev/null; then\n` +
          `    printf 'status\\twritten\\ncommit\\t%s\\n' "$commit"; exit 0\n` +
          `  fi\n` +
          `  attempt=$((attempt + 1)); [ "$attempt" -lt ${CAS_ATTEMPTS} ] || exit 1\n` +
          `done\n`,
        STATE_SCRIPT_TIMEOUT,
        stdin,
      );
      if (field(out, "status") === "superseded") {
        return { _tag: "superseded", seq: Number(field(out, "seq")) } satisfies FlushOutcome;
      }
      yield* store.markFlushed(crew, seq);
      return { _tag: "written", commit: field(out, "commit") ?? "" } satisfies FlushOutcome;
    });

  const read: CrewStateRefService["read"] = (crew, host) =>
    Effect.gen(function* () {
      const out = yield* runFields(
        shell,
        host,
        "readCrewState",
        `commit=$(${git("integration", ["rev-parse", "-q", "--verify", crewStateRef(crew)])}) || { printf 'status\\tnone\\n'; exit 0; }\n` +
          `printf 'status\\tfound\\n'\n` +
          `${git("integration", ["ls-tree", "-r", shellVariable("commit")])} | while read -r mode type sha path; do\n` +
          `  printf 'file\\t%s\\t%s\\n' "$path" "$(${git("integration", ["cat-file", "blob", shellVariable("sha")])} | base64 | tr -d '\\n')"\n` +
          `done\n`,
        STATE_SCRIPT_TIMEOUT,
      );
      if (field(out, "status") !== "found") return Option.none();
      const all = fieldsOf(out, "file").map((value): CrewStateFile => {
        const tab = value.indexOf("\t");
        return { path: value.slice(0, tab), content: fromBase64(value.slice(tab + 1)) };
      });
      const seq = Number(all.find((file) => file.path === SEQ_PATH)?.content.trim() ?? "0");
      return Option.some({ seq, files: all.filter((file) => file.path !== SEQ_PATH) });
    });

  return CrewStateRef.of({ flush, read });
});

export const layer = Layer.effect(CrewStateRef, make);
