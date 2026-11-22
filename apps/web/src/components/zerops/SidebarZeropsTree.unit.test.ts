import { expect, it } from "vite-plus/test";
import { mateDeletionOf, mateGoing, type MateDeletion } from "@t3tools/client-runtime/data";
import { projectHeadingMenu } from "./SidebarZeropsTree.logic.ts";

// witness: apps/web/src/components/zerops/SidebarZeropsTree.logic.ts | reorder === undefined || (!reorder.canMoveUp && !reorder.canMoveDown) → reorder === undefined
it("MN1: A project that cannot move is offered no move", () => {
  const entries = projectHeadingMenu({
    collapsed: false,
    onToggle: () => {},
    onAddMate: () => {},
    onOpen: () => {},
    reorder: { canMoveUp: false, canMoveDown: false, onMove: () => {} },
    setUp: [],
    onBrowseProjects: () => {},
  });
  const labels = entries.flatMap((entry) => (entry.kind === "item" ? [entry.label] : []));
  expect(labels).not.toContain("Move up");
  expect(labels).not.toContain("Move down");
  const separatorPairs = entries.filter(
    (entry, index) => entry.kind === "separator" && entries[index + 1]?.kind === "separator",
  );
  expect(separatorPairs).toEqual([]);
});

// witness: packages/client-runtime/src/data/projections/mateDeletion.ts | if (deletion.failure === undefined) return DELETING; → if (deletion.failure === undefined) return NONE;
it("MN2: A Mate whose deletion HQ runs shows deleting on every device until HQ releases it, and cannot be opened.", () => {
  const at = "2026-11-22T10:00:00.000Z";
  const open = (phase: string) => ({ kind: "mate_deletion", phase, at, acceptedAt: at });
  // HQ's navigation of the Mate's project: what one device reads is what every device reads.
  const phases = {
    accepted: open("accepted"),
    delete_requested: open("delete_requested"),
    delete_accepted: open("delete_accepted"),
    project_gone: open("project_gone"),
    key_requested: open("key_requested"),
    ended: undefined,
    failed: {
      ...open("delete_requested"),
      failure: { step: "delete", code: "projectDeleteFailed", at },
    },
    token_expired: {
      ...open("accepted"),
      failure: { step: "delete", code: "token_expired", at },
      continueBy: "ada",
    },
    restart: { ...open("restart_requested"), kind: "mate_restart" },
  } as const;
  const listings = { listed: "ACTIVE", DELETING: "DELETING", gone: undefined } as const;
  const failed = { kind: "failed", step: "delete", code: "projectDeleteFailed" } as const;
  const deleting = { kind: "deleting" } as const;
  const none = { kind: "none" } as const;
  const expected: Record<keyof typeof phases, Record<keyof typeof listings, MateDeletion>> = {
    accepted: { listed: deleting, DELETING: deleting, gone: deleting },
    delete_requested: { listed: deleting, DELETING: deleting, gone: deleting },
    delete_accepted: { listed: deleting, DELETING: deleting, gone: deleting },
    project_gone: { listed: deleting, DELETING: deleting, gone: deleting },
    key_requested: { listed: deleting, DELETING: deleting, gone: deleting },
    ended: { listed: none, DELETING: deleting, gone: none },
    failed: { listed: failed, DELETING: deleting, gone: failed },
    token_expired: {
      listed: { kind: "waiting", continueBy: "ada", yours: false },
      DELETING: deleting,
      gone: { kind: "waiting", continueBy: "ada", yours: false },
    },
    restart: { listed: none, DELETING: deleting, gone: none },
  };
  for (const phase of Object.keys(phases) as Array<keyof typeof phases>)
    for (const listing of Object.keys(listings) as Array<keyof typeof listings>) {
      const read = mateDeletionOf({
        operation: phases[phase],
        status: listings[listing],
        viewer: "quinn",
      });
      expect({ phase, listing, read }).toEqual({ phase, listing, read: expected[phase][listing] });
    }
  // Deleting, or waiting for its maker: it opens nowhere; a failed one, or none, opens.
  expect(mateGoing(deleting)).toBe(true);
  expect(mateGoing({ kind: "waiting", continueBy: "ada", yours: false })).toBe(true);
  expect(mateGoing(failed)).toBe(false);
  expect(mateGoing(none)).toBe(false);
  // The person HQ waits for reads the wait as theirs.
  expect(
    mateDeletionOf({ operation: phases.token_expired, status: "ACTIVE", viewer: "ada" }),
  ).toEqual({ kind: "waiting", continueBy: "ada", yours: true });
});
