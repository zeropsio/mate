/**
 * The helpers a Mate's wait lists, end to end from the engine's records: the activities they
 * project, the helpers' fold, the dock and its band.
 */
import {
  callItem,
  engineRun,
  engineThreadOfRecords,
  personItem,
  workItem,
} from "@t3tools/client-runtime/data/fixtures";
import {
  deriveAgentPanelModel,
  foldSubagentActivities,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { RunRecord, type Item } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { expect, it } from "vite-plus/test";

import { deriveDock } from "./conversationDock.logic";
import { helpersBand } from "./workingBands.logic";

const key = { environmentId: "env", conversationId: "milo" };
const decode = Schema.decodeUnknownSync(RunRecord);
const t0 = 1_791_620_000_000;
const hour = 3_600_000;

/** A helper the run launched with its Agent call: its work item, as it stands. */
const launched = (run: string, at: number, title: string, status: string, n: number): Item[] => [
  {
    ...callItem(run, n, {
      step: "helper",
      tool: { name: "Agent" },
      words: "Subagent task",
      state: "done",
      input: title,
      shows: { toolName: "Agent", input: { description: title } },
    } as never),
    at,
  } as Item,
  {
    ...workItem(run, n + 1, {
      work: `${run}/w${n}`,
      workKind: "helper",
      status,
      title,
      call: `${run}/i/${n}`,
    } as never),
    at: at + 20,
  } as Item,
];

// Milo's stress run 5: a helper lost at run 4's restart read "2 helpers · Helper: 60-second
// background job · 1h 28m" with an amber mark in every wait of the next tree.
it.each([
  { ended: "lost", wait: "after its turn", working: false },
  { ended: "lost", wait: "while a turn runs", working: true },
  { ended: "stopped", wait: "after its turn", working: false },
])(
  "a helper lost to a restart never shows as running in a later wait: $ended, $wait",
  ({ ended, working }) => {
    const r1 = "milo/r/1";
    const r2 = "milo/r/2";
    const thread = engineThreadOfRecords(key, {
      runs: [
        decode(engineRun("milo", 1, { queuedAt: t0, startedAt: t0 } as never)),
        decode(
          engineRun("milo", 2, {
            queuedAt: t0 + 1.5 * hour,
            startedAt: t0 + 1.5 * hour,
            ...(working ? { state: "running", endedAt: null, end: null } : {}),
          } as never),
        ),
      ],
      items: [
        personItem(r1, 1, "Send a helper off", { at: t0 }),
        ...launched(r1, t0 + 10, "Helper: 60-second background job", ended, 2),
        personItem(r2, 1, "Send three more", { at: t0 + 1.5 * hour }),
        ...launched(r2, t0 + 1.5 * hour + 10, "Second wave 3", "running", 2),
      ],
    })!;
    const dock = deriveDock({
      timelineEntries: [],
      isWorking: working,
      runningTurnId: working ? r2 : null,
      turnStartedAt: working ? new Date(t0 + 1.5 * hour).toISOString() : null,
      agentPanelModel: deriveAgentPanelModel({
        agents: foldSubagentActivities(thread.activities as never, { sessionLive: true }),
      }),
      plan: null,
      backgroundLiveness: working ? null : "working",
      pause: null,
    });
    const helpers = dock?.helpers;
    expect(helpers?.working).toBe(1);
    expect(helpersBand(helpers!)).toMatchObject({ count: null, title: "Second wave 3" });
  },
);
