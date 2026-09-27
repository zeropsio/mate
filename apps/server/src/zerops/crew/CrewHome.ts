/**
 * CrewHome - the crew home's files on the zcp container (`@t3tools/shared/crewHome`
 * holds their format).
 *
 * **One crew per Mate, always `main`.** The crew's id names its directory,
 * `refs/t3/crew-state/<crew>` and every stint's origin, so it must never move:
 * a crew renamed in `crew.yaml` keeps all three. The directory is therefore
 * `<ServerConfig.cwd>/.mate/crew/main/` - where *Describe it to Fen* asks Fen
 * to write the files, and where the editors save through
 * `zerops.crew.files.put`.
 *
 * Only the crew files are read or written (`crew.yaml`, `brief.md`,
 * `jobs/<handle>.md`); a write is refused, with nothing written, when the
 * home it would leave does not parse (`parseCrewHome`). Nothing here applies
 * anything: Apply and the save commands read the home when they run.
 *
 * @module CrewHome
 */
import {
  CREW_FILE_PATH_PATTERN,
  CrewCommandError,
  type CrewRefusalReason,
} from "@t3tools/contracts";
import {
  crewHomeDir,
  parseCrewHome,
  type CrewDefinitionIssue,
  type CrewHomeFile,
  type CrewHomeParse,
} from "@t3tools/shared/crewHome";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { ServerConfig } from "../../config.ts";

/** The one crew of a Mate. */
export const CREW_ID = "main";

const JOBS_DIRECTORY = "jobs";

/** The refusal a definition's issues make: the first issue with a reason of its own names it. */
export const refusalOf = (issues: ReadonlyArray<CrewDefinitionIssue>): CrewCommandError => {
  const reasonOf = (issue: CrewDefinitionIssue): CrewRefusalReason | undefined =>
    issue.code === "handle-duplicate"
      ? "handle-taken"
      : issue.code === "database-undeclared"
        ? "database-undeclared"
        : undefined;
  const named = issues.map(reasonOf).find((reason) => reason !== undefined);
  return new CrewCommandError({
    reason: named ?? "invalid-definition",
    detail: issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"),
  });
};

export interface CrewHomeService {
  /** `<cwd>/.mate/crew/main`. */
  readonly directory: string;
  /** Every crew file present, by path. */
  readonly read: Effect.Effect<ReadonlyArray<CrewHomeFile>, CrewCommandError>;
  /** Writes `files` over the home, unless the home they leave does not parse. */
  readonly write: (files: ReadonlyArray<CrewHomeFile>) => Effect.Effect<void, CrewCommandError>;
  /** The home as it is on disk, parsed. */
  readonly load: Effect.Effect<CrewHomeParse, CrewCommandError>;
}

export class CrewHome extends Context.Service<CrewHome, CrewHomeService>()(
  "t3/zerops/crew/CrewHome",
) {}

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = crewHomeDir(config.cwd, CREW_ID);

  const io = (operation: string) => (cause: unknown) =>
    new CrewCommandError({
      reason: "io",
      detail: `Could not ${operation} the crew home: ${cause instanceof Error ? cause.message : String(cause)}`,
    });

  const readIfPresent = (relative: string) =>
    Effect.gen(function* () {
      const target = path.join(directory, relative);
      if (!(yield* fs.exists(target))) return [];
      return [{ path: relative, content: yield* fs.readFileString(target) }];
    });

  const read: CrewHomeService["read"] = Effect.gen(function* () {
    const jobsDirectory = path.join(directory, JOBS_DIRECTORY);
    const jobs = (yield* fs.exists(jobsDirectory))
      ? (yield* fs.readDirectory(jobsDirectory))
          .map((entry) => `${JOBS_DIRECTORY}/${entry}`)
          .filter((relative) => CREW_FILE_PATH_PATTERN.test(relative))
      : [];
    const candidates = ["crew.yaml", "brief.md", ...jobs].toSorted();
    return (yield* Effect.forEach(candidates, readIfPresent)).flat();
  }).pipe(Effect.mapError(io("read")));

  const load: CrewHomeService["load"] = Effect.map(read, (files) => parseCrewHome(CREW_ID, files));

  const write: CrewHomeService["write"] = (files) =>
    Effect.gen(function* () {
      const incoming = new Map(files.map((file) => [file.path, file.content]));
      const merged = [...(yield* read).filter((file) => !incoming.has(file.path)), ...files];
      const parsed = parseCrewHome(CREW_ID, merged);
      if (parsed.issues.length > 0) return yield* refusalOf(parsed.issues);
      yield* Effect.forEach(files, (file) =>
        Effect.gen(function* () {
          const target = path.join(directory, file.path);
          yield* fs.makeDirectory(path.dirname(target), { recursive: true });
          const staging = `${target}.saving`;
          yield* fs.writeFileString(staging, file.content);
          yield* fs.rename(staging, target);
        }).pipe(Effect.mapError(io("write"))),
      );
    });

  return CrewHome.of({ directory, read, write, load });
});

export const layer = Layer.effect(CrewHome, make);
