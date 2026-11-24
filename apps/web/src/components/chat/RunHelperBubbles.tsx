import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { type RuntimeSubagent } from "@t3tools/client-runtime/state/subagentRuntime";
import { BotIcon, ListTodoIcon, SquareTerminalIcon } from "lucide-react";
import { use } from "react";
import { cn } from "~/lib/utils";
import { Row } from "../ui/row";
import { rises } from "./RunBubble";
import { DidMark, type Failure, FailedMark } from "./RunMarks";
import { PlanSteps } from "./RunPlanSteps";
import { DisclosureButton, Headline, OutputBlock, useDisclosure } from "./RunDisclosure";
import { CallRow } from "./RunCallRow";
import {
  workEntryDisplayIndicatesToolFailure,
  type TurnPlanEntry,
  type WorkLogEntry,
} from "../../session-logic";
import { helpersBubbleOf } from "./helpersBubble.logic";
import { formatWorkDuration } from "./conversation.logic";
import { opensOnto } from "./opens.logic";
import { showHelper } from "./helperFocus";
import { ElapsedSince } from "./ConversationRows";
import { helperRowLine, helperSpan } from "./helpers.logic";
import { normalizeCompactToolLabel, capitalizePhrase } from "./MessagesTimeline.logic";
import { TimelineRowCtx } from "./timelineContext";

// ---------------------------------------------------------------------------
// Helpers, tasks, its to-do list
// ---------------------------------------------------------------------------

const AGENT_STATUS_WORD: Record<RuntimeSubagent["status"], string> = {
  pending: "Starting",
  running: "Working",
  waiting: "Waiting for you",
  idle: "Idle",
  completed: "Done",
  failed: "Failed",
  cancelled: "Stopped",
  interrupted: "Cut off",
};

/**
 * One helper: its task in the words it was given, its state and its clock —
 * never the model or the harness's role name — and under it what it does
 * now, or what it came to. Pressed, its own card opens in the helpers panel:
 * its steps, its clock, its report whole.
 */
function HelperRow({ agent }: { readonly agent: RuntimeSubagent }) {
  const ctx = use(TimelineRowCtx);
  const word = AGENT_STATUS_WORD[agent.status];
  const { since, ranMs } = helperSpan(agent);
  const line = helperRowLine(agent);
  return (
    <li className="grid min-w-0">
      <Row
        size="xs"
        pressable
        aria-label={`${agent.title}: ${word}. Open its work`}
        onClick={() => {
          if (ctx.threadRef !== null) showHelper(scopedThreadKey(ctx.threadRef), agent.id);
          ctx.onOpenAgents();
        }}
        render={<button type="button" />}
        title={
          <span
            className={cn(
              "font-normal",
              agent.status === "failed" ? "text-status-failed-text" : "text-foreground/90",
            )}
          >
            {agent.title}
          </span>
        }
        meta={
          <>
            {word}
            {since !== null ? (
              <>
                {" · "}
                <ElapsedSince since={since} />
              </>
            ) : ranMs !== null && ranMs >= 1000 ? (
              ` · ${formatWorkDuration(ranMs)}`
            ) : null}
          </>
        }
        line={line === null ? undefined : <span className="line-clamp-2">{line}</span>}
        lineWraps
      />
    </li>
  );
}

/** Helpers it started: how many and what for; each one, its state and what it said, opened under it. */
export function HelpersBubble({ entry }: { readonly entry: WorkLogEntry }) {
  const ctx = use(TimelineRowCtx);
  const disclosure = useDisclosure();
  const spawn = entry.agentSpawn;
  if (!spawn) return null;
  const { agents, summary, words, what, whatOpen, failed, ended } = helpersBubbleOf(
    ctx.agentPanelModel,
    spawn,
  );
  // Helpers not known yet: nothing to open onto.
  const opens = opensOnto({ control: "helpers", agents: agents.length });
  const head = (
    <Headline column opens={opens} timeTone="muted" time={summary.live ? "Working" : ended}>
      <span>
        <span className="text-foreground/75">{words}</span>
        {/* Open, the rows name the helpers: the head never says their names again. */}
        {(disclosure.open ? whatOpen : what) ? (
          <span className="text-muted-foreground">{` · ${disclosure.open ? whatOpen : what}`}</span>
        ) : null}
      </span>
    </Headline>
  );
  return (
    <CallRow
      failure={failed ? "broken" : null}
      kind="helpers"
      mark={failed ? <FailedMark failure="broken" /> : <DidMark icon={BotIcon} />}
    >
      {opens ? (
        <DisclosureButton
          label={`${words}. ${disclosure.open ? "Hide" : "Show"} them`}
          onToggle={disclosure.toggle}
          open={disclosure.open}
        >
          {head}
        </DisclosureButton>
      ) : (
        <div>{head}</div>
      )}
      {opens && disclosure.open ? (
        // Its helpers' words on the bubble's text edge: 8 px in, and their own 6.
        <div
          className={cn("grid gap-2 px-2 pb-2.5", rises(disclosure.made))}
          data-chat-detail
          data-chat-detail-rises={disclosure.made ? "" : undefined}
        >
          <ul className="grid gap-0.5">
            {agents.map((agent) => (
              <HelperRow key={agent.id} agent={agent} />
            ))}
          </ul>
        </div>
      ) : null}
    </CallRow>
  );
}

/** A task in the words it was given. */
function taskTitle(entry: WorkLogEntry): string {
  return capitalizePhrase(normalizeCompactToolLabel(entry.toolTitle ?? entry.label));
}

/** What a task reported: a helper's report in words, a shell's output as it printed it. */
function TaskReport({ entry }: { readonly entry: WorkLogEntry }) {
  const report = entry.detail?.trim();
  if (!report) return null;
  return <OutputBlock mono={entry.agentRole === undefined} text={report} />;
}

/** A background task or a helper reporting back, where its result reached the run; its report under it. */
export function TaskBubble({
  entry,
  undone = false,
}: {
  readonly entry: WorkLogEntry;
  /** A background job that failed, in a run that ended well: quiet, not red (K9). */
  readonly undone?: boolean;
}) {
  const disclosure = useDisclosure();
  const failed = workEntryDisplayIndicatesToolFailure(entry);
  const failure: Failure | null = !failed ? null : undone ? "undone" : "broken";
  const words = `${taskTitle(entry)} ${failed ? "failed" : "finished"}`;
  const where = entry.agentRole !== undefined ? "helper" : "ran in the background";
  const reported = Boolean(entry.detail?.trim());
  const line = (
    <Headline column opens={reported}>
      <span className="text-foreground/75">{words}</span>
      <span className="text-muted-foreground">{` · ${where}`}</span>
    </Headline>
  );
  return (
    <CallRow
      failure={failure}
      kind="task"
      mark={
        failure !== null ? (
          <FailedMark failure={failure} />
        ) : (
          <DidMark icon={entry.agentRole !== undefined ? BotIcon : SquareTerminalIcon} />
        )
      }
    >
      {reported ? (
        <DisclosureButton
          label={`${words}. ${disclosure.open ? "Hide" : "Show"} what it reported`}
          onToggle={disclosure.toggle}
          open={disclosure.open}
        >
          {line}
        </DisclosureButton>
      ) : (
        <div>{line}</div>
      )}
      {disclosure.open ? (
        <div
          className={cn("pt-2", rises(disclosure.made))}
          data-chat-detail
          data-chat-detail-rises={disclosure.made ? "" : undefined}
        >
          <TaskReport entry={entry} />
        </div>
      ) : null}
    </CallRow>
  );
}

/** Its to-do list: how far it got, the step in hand; the list under it. */
export function PlanBubble({ plan }: { readonly plan: TurnPlanEntry }) {
  const disclosure = useDisclosure();
  const { steps } = plan.plan;
  const done = steps.filter((step) => step.status === "completed").length;
  const current =
    steps.find((step) => step.status === "inProgress")?.step ??
    steps.find((step) => step.status === "pending")?.step ??
    null;
  // A list of the one step its line names is the whole of it.
  const opens = opensOnto({ control: "plan", steps: steps.map((step) => step.step), current });
  const head = (
    <Headline column opens={opens} time={`${done}/${steps.length}`}>
      <span>
        <span className="text-foreground/75">To-do list</span>
        {current !== null ? <span className="text-muted-foreground">{` · ${current}`}</span> : null}
      </span>
    </Headline>
  );
  return (
    <CallRow kind="plan" mark={<DidMark icon={ListTodoIcon} />}>
      {opens ? (
        <DisclosureButton
          label={`To-do list, ${done} of ${steps.length} done. ${disclosure.open ? "Hide" : "Show"} it`}
          onToggle={disclosure.toggle}
          open={disclosure.open}
        >
          {head}
        </DisclosureButton>
      ) : (
        <div>{head}</div>
      )}
      {opens && disclosure.open ? (
        <div
          className={cn("pt-2", rises(disclosure.made))}
          data-chat-detail
          data-chat-detail-rises={disclosure.made ? "" : undefined}
        >
          <PlanSteps steps={steps} />
        </div>
      ) : null}
    </CallRow>
  );
}
