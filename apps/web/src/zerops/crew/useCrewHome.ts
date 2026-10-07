/**
 * The crew home's files as a definition, for an editor while it is mounted
 * (PRD §4.7): read through `zerops.crew.files.get` when the editor mounts,
 * parsed by the shared format (`parseCrewHome`), and written back file by
 * file — an editor sends only the files it changed, then reads them again.
 */
import type { CrewFiles } from "@t3tools/contracts";
import { crewHome } from "@t3tools/client-runtime/data";
import {
  renderCrewHome,
  type CrewDefinition,
  type CrewDefinitionIssue,
} from "@t3tools/shared/crewHome";
import { useCallback, useMemo } from "react";

import type { UseCrewCommand } from "./useCrewCommand";

export interface CrewHomeRead {
  /** `null` while reading, or when the read failed (the command's error says why). */
  readonly definition: CrewDefinition | null;
  readonly issues: ReadonlyArray<CrewDefinitionIssue>;
  /** Writes `definition`'s files among `paths`; whether they were saved. */
  readonly save: (definition: CrewDefinition, paths: ReadonlyArray<string>) => Promise<boolean>;
  /** Reads the files again: someone else — the Mate — may have written them. */
  readonly reload: () => Promise<void>;
}

export function useCrewHome(
  commands: Pick<UseCrewCommand, "files" | "readFiles" | "writeFiles">,
): CrewHomeRead {
  const { readFiles, writeFiles } = commands;
  const read = useMemo(() => crewHome(commands.files), [commands.files]);

  const save = useCallback(
    async (definition: CrewDefinition, paths: ReadonlyArray<string>) => {
      const files: CrewFiles["files"] = renderCrewHome(definition).filter((file) =>
        paths.includes(file.path),
      );
      if (!(await writeFiles({ files }))) return false;
      const saved = await readFiles();
      return saved !== null;
    },
    [readFiles, writeFiles],
  );

  const reload = useCallback(async () => {
    await readFiles();
  }, [readFiles]);

  return { definition: read.definition, issues: read.issues, save, reload };
}
