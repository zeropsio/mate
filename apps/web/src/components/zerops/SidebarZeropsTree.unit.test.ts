import { waitingWords } from "@t3tools/client-runtime/data";
import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { mateDeletionOf, mateGoing, type MateDeletion } from "@t3tools/client-runtime/data";
import { HqOperation } from "@t3tools/client-runtime/data/fixtures";
import { projectHeadingMenu } from "./SidebarZeropsTree.logic.ts";

const decodeHqOperation = Schema.decodeUnknownSync(HqOperation);

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

// witness: packages/client-runtime/src/data/projections/mateDeletion.ts | if (deletion.kind === "going") return DELETING; → if (deletion.kind === "going") return NONE;
it("MN2: A Mate whose deletion HQ runs shows deleting on every device until HQ releases it, and cannot be opened", () => {
  const at = "2026-11-22T10:00:00.000Z";
  const open = (phase: string) => ({
    id: "op-1",
    kind: "mate_deletion",
    phase,
    at,
    acceptedAt: at,
  });
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
      failure: {
        step: "delete_project",
        code: "project_delete_failed",
        at,
        origin: "zerops_process",
      },
    },
    token_expired: {
      ...open("accepted"),
      failure: { step: "delete_project", code: "token_expired", at, origin: "hq" },
      continueBy: "ada",
    },
    restart: { ...open("restart_requested"), kind: "mate_restart" },
  } as const;
  const listings = { listed: "ACTIVE", DELETING: "DELETING", gone: undefined } as const;
  const failed = { kind: "failed", failure: phases.failed.failure } as const;
  const deleting = { kind: "deleting" } as const;
  const none = { kind: "none" } as const;
  const waiting = {
    kind: "waiting",
    id: "op-1",
    operationKind: "mate_deletion",
    continueBy: "ada",
    yours: false,
    ...waitingWords("token_expired"),
  } as const;
  const expected: Record<keyof typeof phases, Record<keyof typeof listings, MateDeletion>> = {
    accepted: { listed: deleting, DELETING: deleting, gone: deleting },
    delete_requested: { listed: deleting, DELETING: deleting, gone: deleting },
    delete_accepted: { listed: deleting, DELETING: deleting, gone: deleting },
    project_gone: { listed: deleting, DELETING: deleting, gone: deleting },
    key_requested: { listed: deleting, DELETING: deleting, gone: deleting },
    ended: { listed: none, DELETING: deleting, gone: none },
    failed: { listed: failed, DELETING: deleting, gone: failed },
    token_expired: { listed: waiting, DELETING: waiting, gone: waiting },
    restart: { listed: none, DELETING: deleting, gone: none },
  };
  for (const phase of Object.keys(phases) as Array<keyof typeof phases>)
    for (const listing of Object.keys(listings) as Array<keyof typeof listings>) {
      const read = mateDeletionOf({
        operation: phases[phase],
        status: listings[listing],
      });
      expect({ phase, listing, read }).toEqual({ phase, listing, read: expected[phase][listing] });
    }
  // Deleting, or waiting for its maker: it opens nowhere; a failed one, or none, opens.
  expect(mateGoing(deleting)).toBe(true);
  expect(mateGoing(waiting)).toBe(true);
  expect(mateGoing(failed)).toBe(false);
  expect(mateGoing(none)).toBe(false);
});

// witness: packages/client-runtime/src/data/projections/hqOperation.ts | return { kind: "failed", id: operation.id, failure: operation.failure }; → return { kind: "failed", id: operation.id, failure: { step: operation.failure.step, code: operation.failure.code, at: operation.failure.at, origin: operation.failure.origin } };
it("MN24: A Mate whose deletion stopped on its maker's lapsed sign-in is theirs to continue by HQ's operation id and waits for them to everyone else, and a failed one carries HQ's failure as sent, with who stopped it; breaks: the maker has no way out of a stopped deletion, or a failed one hides who stopped it and why", () => {
  const at = "2026-11-22T10:00:00.000Z";
  // HQ reads navigation for one person: it offers the deletion's Continue to its maker alone.
  const stopped = (failure: unknown, continueBy?: string, offers: ReadonlyArray<string> = []) =>
    decodeHqOperation({
      id: "op-7",
      kind: "mate_deletion",
      phase: "delete_requested",
      at,
      acceptedAt: at,
      failure,
      offers,
      ...(continueBy === undefined ? {} : { continueBy }),
    });
  const tokenExpired = { step: "delete_project", code: "token_expired", at, origin: "hq" };
  const zeropsFailure = {
    step: "delete_project",
    code: "insufficientPermissions",
    at,
    origin: "zerops",
    zerops: {
      words: "Insufficient permissions",
      status: 403,
      error: { code: "insufficientPermissions", message: "Insufficient permissions" },
      request: { method: "DELETE", path: "/project/v4/example" },
    },
  };
  const hqFailure = { step: "delete_project", code: "mate_not_found", at, origin: "hq" };
  const cases: ReadonlyArray<[string, ReturnType<typeof stopped>, MateDeletion]> = [
    [
      "its maker reads",
      stopped(tokenExpired, "ada", ["continue"]),
      {
        kind: "waiting",
        id: "op-7",
        operationKind: "mate_deletion",
        continueBy: "ada",
        yours: true,
        ...waitingWords("token_expired"),
      },
    ],
    [
      "someone else reads",
      stopped(tokenExpired, "ada"),
      {
        kind: "waiting",
        id: "op-7",
        operationKind: "mate_deletion",
        continueBy: "ada",
        yours: false,
        ...waitingWords("token_expired"),
      },
    ],
    ["Zerops refused", stopped(zeropsFailure), { kind: "failed", failure: zeropsFailure }],
    ["HQ stopped it", stopped(hqFailure), { kind: "failed", failure: hqFailure }],
  ];
  for (const [state, operation, expected] of cases)
    expect({ state, read: mateDeletionOf({ operation, status: "ACTIVE" }) }).toEqual({
      state,
      read: expected,
    });
});
