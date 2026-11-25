import { cn } from "~/lib/utils";
import { RUN_TRAY_SLICE } from "~/components/chat/runTray";
import { useState } from "react";

import type { WorkLineFace } from "~/components/chat/conversation.logic";
import { ErrorLine } from "~/components/chat/ConversationRows";
import { RunLine } from "~/components/chat/RunChat";
import { TimelineRowActivityCtx, TimelineRowCtx } from "~/components/chat/timelineContext";

import { definePlayground, jsxCode, jsxElement } from "../kitPlayground";
import { variantsOf } from "../specimenLabel";
import { ROW_SHARED, ROW_WORKING } from "../states/fixtures";

/** Which of a conversation's own lines: the Mate's run, or a turn that stopped. */
const LINES = ["run", "stopped"] as const;
const FACES = variantsOf<WorkLineFace>({
  working: true,
  idle: true,
  produced: true,
  failed: true,
  paused: true,
  stopped: true,
  interrupted: true,
  brokeOff: true,
});
/** How long the run has gone on, in seconds. */
const ELAPSED = { "8 s": 8, "23 min": 23 * 60, "2 h": 2 * 60 * 60 } as const;
const ELAPSED_IDS = Object.keys(ELAPSED) as (keyof typeof ELAPSED)[];

/** A run started `seconds` ago, live or settled now, as its conversation's row holds it. */
function Run({
  seconds,
  live,
  face,
  waiting,
}: {
  readonly seconds: number;
  readonly live: boolean;
  readonly face: WorkLineFace;
  readonly waiting: boolean;
}) {
  const [now] = useState(() => Date.now());
  const startedAt = new Date(now - seconds * 1000).toISOString();
  return (
    <TimelineRowCtx value={ROW_SHARED}>
      <TimelineRowActivityCtx value={ROW_WORKING}>
        <div className={cn(RUN_TRAY_SLICE.top, "w-[560px]")}>
          <RunLine
            status={{
              live,
              face: live ? "working" : face,
              startedAt,
              endedAt: live ? null : new Date(now).toISOString(),
              waitedMs: 0,
              waitingSince: live && waiting ? new Date(now - 5000).toISOString() : null,
              worked: true,
            }}
          />
        </div>
      </TimelineRowActivityCtx>
    </TimelineRowCtx>
  );
}

export default definePlayground({
  section: "conversation-lines",
  name: "Conversation lines",
  imports: [
    'import { ErrorLine } from "~/components/chat/ConversationRows";',
    'import { RunLine } from "~/components/chat/RunChat";',
  ].join("\n"),
  controls: {
    line: { kind: "enum", options: LINES, note: "run: RunLine; stopped: ErrorLine" },
    live: { kind: "boolean", note: "run: it works now, its clock running" },
    face: { kind: "enum", options: FACES, note: "run, settled: how it ended" },
    elapsed: { kind: "enum", options: ELAPSED_IDS, note: "run: how long it has gone on" },
    waiting: { kind: "boolean", note: "run, live: it waits on the person; its clock stands" },
    label: { kind: "text", note: "stopped: what happened, in one sentence" },
    detail: { kind: "text", note: "stopped: the words the agent gave, under it" },
    calm: { kind: "boolean", note: "stopped: an expected refusal, told, never alerted" },
    dismissible: { kind: "boolean", note: "stopped: the conversation's end row, a quiet ×" },
  },
  initial: {
    line: "run",
    live: true,
    face: "produced",
    elapsed: "8 s",
    waiting: false,
    label: "The turn stopped.",
    detail: "Claude closed the stream after 3 minutes.",
    calm: false,
    dismissible: true,
  },
  render: (args) =>
    args.line === "run" ? (
      <Run
        face={args.face}
        key={`${args.elapsed}-${String(args.live)}-${String(args.waiting)}`}
        live={args.live}
        seconds={ELAPSED[args.elapsed]}
        waiting={args.waiting}
      />
    ) : (
      <div className="w-[560px]">
        <ErrorLine
          calm={args.calm}
          detail={args.detail === "" ? undefined : args.detail}
          label={args.label}
          onDismiss={args.dismissible ? () => {} : undefined}
        />
      </div>
    ),
  jsx: (args) =>
    args.line === "run"
      ? jsxElement("RunLine", {
          status: jsxCode(
            `{ live: ${String(args.live)}, face: "${args.live ? "working" : args.face}", startedAt, endedAt: ${
              args.live ? "null" : "endedAt"
            }, waitingSince: ${args.live && args.waiting ? "waitingSince" : "null"}, waitedMs: 0, worked: true }`,
          ),
        })
      : jsxElement(
          "ErrorLine",
          {
            label: args.label,
            detail: args.detail === "" ? undefined : args.detail,
            calm: args.calm,
            onDismiss: args.dismissible ? jsxCode("dismiss") : undefined,
          },
          undefined,
          { calm: false },
        ),
  usage: {
    do: [
      "Keep the Mate's run on its own line with its clock while it works.",
      "Say a stopped turn in one sentence, with what the agent said under it.",
      "Tell an expected refusal calmly: a usage limit, a sign-in.",
    ],
    dont: [
      "Alert in red for a refusal the person expected.",
      "Show the agent's raw error as the sentence: it goes in the detail.",
      "Call a Mate the agent: say its name.",
    ],
  },
});
