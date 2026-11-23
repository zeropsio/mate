import { expect, it } from "vite-plus/test";
import { mateRowLife } from "./SidebarMateRow.logic.ts";

// witness: apps/web/src/components/zerops/SidebarMateRow.logic.ts | return mateDeleting(project.status, mateGoing(mateDeletionOfProject(project))) → return mateDeleting(project.status, false)
it("MN63: A listed Mate's life, the one its menu row, its find in the jump box and its face on a folded group wear, is deleting while HQ's deletion of it runs or Zerops lists its project DELETING, before anything of its coming up; breaks: a Mate HQ is deleting wears its conversation's face, or its coming up's, in the jump box and a folded group", () => {
  const at = "2026-11-23T10:00:00.000Z";
  const hqDeleting = {
    id: "op-1",
    kind: "mate_deletion",
    phase: "delete_requested",
    at,
    acceptedAt: at,
  };
  const coming = { kind: "coming", line: "Setting up…" } as const;
  const failed = { kind: "failed", line: "It did not come.", verb: "try-again" } as const;
  const rows = [
    {
      name: "Zerops deletes it while it comes up",
      status: "DELETING",
      hq: undefined,
      coming,
      life: "deleting",
    },
    {
      name: "HQ deletes it",
      status: "ACTIVE",
      hq: { operation: hqDeleting },
      coming: undefined,
      life: "deleting",
    },
    {
      name: "HQ deletes it while it comes up",
      status: "ACTIVE",
      hq: { operation: hqDeleting },
      coming,
      life: "deleting",
    },
    {
      name: "its coming up failed",
      status: "ACTIVE",
      hq: undefined,
      coming: failed,
      life: "failed",
    },
    { name: "it comes up", status: "ACTIVE", hq: undefined, coming, life: "coming" },
    {
      name: "nothing comes or goes",
      status: "ACTIVE",
      hq: undefined,
      coming: undefined,
      life: "up",
    },
  ] as const;
  for (const row of rows) {
    const life = mateRowLife({ status: row.status, hq: row.hq }, row.coming);
    expect({ name: row.name, life }).toEqual({ name: row.name, life: row.life });
  }
});
