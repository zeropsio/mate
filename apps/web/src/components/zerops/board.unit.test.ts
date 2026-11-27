import type { HqAppTask } from "@t3tools/shared/hqIntake";
import { expect, it } from "vite-plus/test";

import { boardOf } from "./projectAutomation/taskBoard.logic.ts";

const NOW = Date.parse("2026-11-27T12:00:00Z");

const task = (patch: Partial<HqAppTask> & Pick<HqAppTask, "id" | "state">): HqAppTask => ({
  title: `Task ${patch.id}`,
  label: "a conversation",
  url: null,
  mate: null,
  requestedBy: null,
  createdAt: "2026-11-20T12:00:00Z",
  startedAt: null,
  endedAt: null,
  spentUsd: 4.2,
  workedMs: null,
  detail: null,
  change: null,
  pullRequest: null,
  link: null,
  ...patch,
});

// Rhea put two tasks from her Moss's chat; Ivo took one for his Fern, his Fern linked a change to
// the other. Mara reads the Board; her list holds Moss, not Ivo's Fern.
const put = {
  kind: "conversation" as const,
  putBy: "u-rhea",
  mateProjectId: "p-moss",
  conversationId: "c-moss",
  title: "From Moss",
};
const ivo = { kind: "person" as const, userId: "u-ivo", mateProjectId: "p-fern" };
const taken = task({
  id: "1",
  state: "taken",
  source: put,
  taker: ivo,
  takenAt: "2026-11-27T10:00:00Z",
});
const linked = task({
  id: "2",
  state: "taken",
  source: { ...put, mateProjectId: "p-fern", conversationId: "c-fern" },
  taker: ivo,
  takenAt: "2026-11-26T12:00:00Z",
  changes: [{ repo: "shop", number: 7 }],
});

// witness: apps/web/src/components/zerops/projectAutomation/taskBoard.logic.ts | lane === "queued" || holder?.kind === "person" → lane === "queued"
it("MN129: A task a person took stands In progress under their name and their Mate, Up for review once their Mate linked a change, and never with the organization's cost; one put from a chat names who put it, and leads back to that chat only for a reader whose list holds its Mate; breaks: a person's own work is billed to the organization on the Board, or a reader is sent into a Mate they cannot open", () => {
  const { lanes } = boardOf([taken, linked], NOW, {
    appId: "shop",
    viewerId: "u-mara",
    personName: (userId) => ({ "u-rhea": "Rhea", "u-ivo": "Ivo" })[userId],
    mateName: (projectId) => (projectId === "p-moss" ? "Moss" : undefined),
  });
  const shown = (rows: typeof lanes.progress) =>
    rows.map((row) => ({
      id: row.id,
      state: row.state,
      who: row.who,
      cost: row.cost,
      origin: row.origin.words,
      back: row.origin.conversation,
    }));
  expect(shown(lanes.progress)).toEqual([
    {
      id: "1",
      state: "Taken by Ivo",
      who: "2h",
      cost: "",
      origin: "Put on board by Rhea",
      back: { mateProjectId: "p-moss", conversationId: "c-moss" },
    },
  ]);
  expect(shown(lanes.review)).toEqual([
    {
      id: "2",
      state: "Taken by Ivo",
      who: "1d",
      cost: "",
      origin: "Put on board by Rhea",
      back: null,
    },
  ]);
});
