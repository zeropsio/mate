/**
 * One service's build log in a batch deploy: read while its row is drawn, opened in a dialog of its
 * own. A batch runs a build per service, so each row has its own way to its own log — one way
 * under all of them was one service's log passing for the batch's (the owner, 2026-11-11: "and
 * the log? its shared?").
 */
import type { BuildLogQuery } from "@t3tools/client-runtime/zerops/activity/buildLog";
import { type JSX, useState } from "react";

import { ZeropsBuildLog } from "../../components/zerops/ZeropsBuildLog";

import { useBuildLog } from "./useBuildLog.ts";

export function ServiceBuildLog({
  projectId,
  query,
  live,
  stands,
  subject,
}: {
  readonly projectId: string | null;
  /** The service's own build; `null` while its log is not read (a line that stands closed). */
  readonly query: BuildLogQuery | null;
  /** Its build is under way: new lines keep coming. */
  readonly live: boolean;
  /** Its deploy settled: the way to its log stands while its lines are read. */
  readonly stands: boolean;
  /** The service's hostname, as the dialog names it. */
  readonly subject: string;
}): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const log = useBuildLog({ projectId, query, live });
  return (
    <ZeropsBuildLog
      lines={log.lines}
      onToggle={() => setOpen(!open)}
      open={open}
      stands={stands}
      status={log.status}
      subject={subject}
    />
  );
}
