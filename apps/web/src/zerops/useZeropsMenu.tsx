import { useAtomValue } from "@effect/atom-react";
import { menuRowsFromHq } from "@t3tools/client-runtime/zerops/hq";
import {
  projectRecordToZeropsProject,
  ZeropsOrganizationId,
  ZeropsProjectId,
} from "@t3tools/client-runtime/zerops/data";
import { Atom } from "effect/unstable/reactivity";
import type { CandidateRow } from "@t3tools/client-runtime/zerops/projections";
import { useMemo } from "react";
import { createPortal } from "react-dom";
import { SidebarZeropsTree } from "../components/zerops/SidebarZeropsTree";
import {
  hqLoginsAtom,
  hqReadyAgentsAtom,
  hqStructureAtom,
  zeropsDataRuntimeAtom,
} from "../state/zerops";
import { menuMemory } from "./menuMemory";
import { useZeropsSession } from "./ZeropsSessionProvider";
import { hqOutageLine } from "./hqStructure";

const NO_ROWS: ReadonlyArray<CandidateRow> = [];
const NO_ACTION = () => {};

/** Menu membership is HQ's; inventory and admission enrich rows, never enumerate them. */
export function useZeropsMenu<Row extends CandidateRow>(
  candidates: ReadonlyArray<Row>,
): ReadonlyArray<Row | CandidateRow> {
  const { activeOrganization } = useZeropsSession();
  const view = useAtomValue(hqStructureAtom);
  const runtime = useAtomValue(zeropsDataRuntimeAtom);
  const organizationId = activeOrganization?.id;
  const held = organizationId === undefined ? undefined : menuMemory().structures[organizationId];
  const structure = view !== null && view.organizationId === organizationId ? view.structure : held;
  const rows = useMemo(
    () =>
      Atom.make((get) => {
        if (organizationId === undefined || structure == null) return NO_ROWS;
        const projects = [];
        const gone = new Set<string>();
        if (runtime !== null) {
          const ids = [
            ...structure.ungrouped.map((row) => row.projectId),
            ...structure.apps.flatMap((app) => app.projects.map((row) => row.projectId)),
          ];
          for (const id of ids) {
            const ref = {
              kind: "project" as const,
              organization: {
                kind: "organization" as const,
                account: runtime.scope.account,
                organizationId: ZeropsOrganizationId.make(organizationId),
              },
              projectId: ZeropsProjectId.make(id),
            };
            const { value } = get(runtime.reads.project(ref));
            if (value.knowledge === "unavailable" && value.reason === "not-found") gone.add(id);
            if (value.knowledge === "observed") {
              const project = projectRecordToZeropsProject(value.record);
              if (project !== null) projects.push(project);
            }
          }
        }
        // Each Mate as HQ's overview of it says it: who signed its agent in, whether it needs nobody.
        return menuRowsFromHq({
          organizationId,
          structure,
          projects,
          candidates,
          gone,
          logins: get(hqLoginsAtom),
          readyAgents: get(hqReadyAgentsAtom),
        });
      }),
    [organizationId, structure, runtime, candidates],
  );
  return useAtomValue(rows);
}

/** The admitted product takes over this same HQ row list; the pre-admission menu has no verbs. */
export function ZeropsMenuPreview() {
  const rows = useZeropsMenu(NO_ROWS);
  const view = useAtomValue(hqStructureAtom);
  const slot = typeof document === "undefined" ? null : document.getElementById("boot-shell-menu");
  const { activeOrganization } = useZeropsSession();
  const kept =
    activeOrganization == null ? undefined : menuMemory().structures[activeOrganization.id];
  const line = hqOutageLine(
    view ??
      (kept === undefined
        ? null
        : {
            organizationId: activeOrganization!.id,
            structure: kept,
            readAt: kept.readAt,
            current: false,
            changes: null,
            appReads: null,
            unavailableSince: null,
          }),
    "locale",
    Date.now(),
  );
  if (slot === null) return null;
  return createPortal(
    <div inert className="h-full overflow-y-auto px-4 pt-20">
      <SidebarZeropsTree
        candidates={rows}
        complete={false}
        onSelect={NO_ACTION}
        onBrowseProjects={NO_ACTION}
        hqOutage={line}
      />
    </div>,
    slot,
  );
}
