/**
 * The crew home's files as a definition, for an editor while it is mounted
 * (PRD §4.7): read through `zerops.crew.files.get` when the editor mounts,
 * parsed by the shared format (`parseCrewHome`), and written back file by
 * file — an editor sends only the files it changed, then reads them again.
 */
import type { CrewFiles } from "@t3tools/contracts";
import {
  parseCrewHome,
  renderCrewHome,
  type CrewDefinition,
  type CrewDefinitionIssue,
} from "@t3tools/shared/crewHome";
import { useCallback, useEffect, useState } from "react";

import type { UseCrewCommand } from "./useCrewCommand";

/** The crew's id only names its directory on the server; the editors never see it. */
const EDITOR_CREW_ID = "crew";

export interface CrewHomeRead {
  /** `null` while reading, or when the read failed (the command's error says why). */
  readonly definition: CrewDefinition | null;
  readonly issues: ReadonlyArray<CrewDefinitionIssue>;
  /** Writes `definition`'s files among `paths`; whether they were saved. */
  readonly save: (definition: CrewDefinition, paths: ReadonlyArray<string>) => Promise<boolean>;
  /** Reads the files again: someone else — the Mate — may have written them. */
  readonly reload: () => Promise<void>;
}

const parseFiles = (files: CrewFiles) => {
  const parsed = parseCrewHome(EDITOR_CREW_ID, files.files);
  return { definition: parsed.definition ?? null, issues: parsed.issues };
};

export function useCrewHome(
  commands: Pick<UseCrewCommand, "readFiles" | "writeFiles">,
): CrewHomeRead {
  const { readFiles, writeFiles } = commands;
  const [read, setRead] = useState<{
    readonly definition: CrewDefinition | null;
    readonly issues: ReadonlyArray<CrewDefinitionIssue>;
  }>({ definition: null, issues: [] });

  useEffect(() => {
    let current = true;
    void readFiles().then((files) => {
      if (current && files !== null) setRead(parseFiles(files));
    });
    return () => {
      current = false;
    };
  }, [readFiles]);

  const save = useCallback(
    async (definition: CrewDefinition, paths: ReadonlyArray<string>) => {
      const files: CrewFiles["files"] = renderCrewHome(definition).filter((file) =>
        paths.includes(file.path),
      );
      if (!(await writeFiles({ files }))) return false;
      const saved = await readFiles();
      if (saved !== null) setRead(parseFiles(saved));
      return true;
    },
    [readFiles, writeFiles],
  );

  const reload = useCallback(async () => {
    const files = await readFiles();
    if (files !== null) setRead(parseFiles(files));
  }, [readFiles]);

  return { definition: read.definition, issues: read.issues, save, reload };
}
