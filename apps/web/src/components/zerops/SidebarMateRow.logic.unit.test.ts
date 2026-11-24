import { expect, it } from "vite-plus/test";
import {
  initialContainer,
  transitionContainer,
  type ContainerEvent,
  type ContainerMachine,
  type TargetKey,
} from "@t3tools/client-runtime/zerops/environments";
import { mateRestartSaid } from "../../zerops/mateMoments.logic.ts";
import { mateRowLife, mateRowSecond, sidebarMateVerbs } from "./SidebarMateRow.logic.ts";

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

// witness: apps/web/src/zerops/mateMoments.logic.ts | return container?.state.level === "restarting" && !container.overdue; → return container?.state.level === "restarting" && container.connectedSince !== null && !container.overdue;
it("MN67: A Mate restarting reads restarting on its row and card for the whole restart, after its socket to the tab is gone and over its sign-in line, and past the restart's cap no longer does; breaks: the row says it for three seconds on the Mate's page and never from the overview", () => {
  const key = "p1:s1" as TargetKey;
  const at = (ms: number) => ({ wall: ms, mono: ms });
  const step = (machine: ContainerMachine, event: ContainerEvent, ms: number) =>
    transitionContainer(machine, event, { now: at(ms), watched: true }).state;
  const second = (machine: ContainerMachine) =>
    mateRowSecond({
      view: { state: "idle", reply: undefined, slot: { kind: "none" } },
      askLine: { kind: "sign-in", text: "Sign it in", waitsOnViewer: true },
      restarting: mateRestartSaid(new Map([[key, machine]]), key),
      outsideHq: false,
      noContainer: false,
      mine: true,
      waitsOn: undefined,
      change: undefined,
    }).kind;
  const linked = step(initialContainer(), { type: "LINK", connected: true }, 1);
  const pressed = step(
    linked,
    { type: "INTENT", intent: { kind: "restart", since: at(2), initAt: "2026-11-23T10:00:00Z" } },
    2,
  );
  expect(second(pressed)).toBe("restarting");
  const socketGone = step(pressed, { type: "LINK", connected: false }, 3);
  expect(second(socketGone)).toBe("restarting");
  const pastCap = step(
    socketGone,
    { type: "PROBED", reading: { kind: "unreachable" }, sentAt: at(200_000) },
    200_001,
  );
  expect(second(pastCap)).toBe("sign-in");
});

// witness: apps/web/src/components/zerops/SidebarMateRow.logic.ts |   "end-restart": null, → "end-restart-off": null,
it("MN74: A Mate's row menu keeps the Continue and End HQ offers on its waiting restart or move; breaks: an Owner sees no way to end a restart that holds the Mate", () => {
  const offered = ["continue-restart", "end-restart", "continue-move", "end-move"];
  const entries = offered.map((id) => ({ id, label: id, onSelect: () => {} }));
  expect(
    sidebarMateVerbs(entries).flatMap((entry) => ("separator" in entry ? [] : [entry.id])),
  ).toEqual(offered);
});
