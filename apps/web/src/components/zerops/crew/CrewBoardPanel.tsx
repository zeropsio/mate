/**
 * The crew's board — right-panel kind `crew`, opened from the Crew section of
 * the Zerops tab (PRD §4.4).
 *
 * Its columns follow the tasks' states (`CrewBoardPanel.logic.ts`): the lead's
 * proposed tasks sit on top of *Waiting on you* as one plan card, every other
 * task is a card that opens its sheet. The panel stacks the columns while it
 * is narrow and lays them side by side once widened (the panel's own maximize
 * control). Every press is one crew command; what it changes arrives on the
 * crew feed, so nothing here keeps a copy of the board.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { crewRefusalSentence } from "@t3tools/client-runtime/zerops/crew/phrases";
import type {
  CrewCommand,
  CrewStatus,
  CrewTask,
  EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { ScrollArea } from "~/components/ui/scroll-area";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Sheet, SheetHeader, SheetPopup, SheetTitle } from "~/components/ui/sheet";
import { Textarea } from "~/components/ui/textarea";
import { buildThreadRouteParams } from "~/threadRoutes";
import { useCrew } from "~/zerops/crew/useCrew";
import { useCrewCommand } from "~/zerops/crew/useCrewCommand";

import { FlatCard, MateFace, MicroLabel, Pill, StatusDot } from "../primitives";
import {
  crewBoardModel,
  crewDependencyOptions,
  crewNewTaskCommand,
  crewPlanCommand,
  crewTaskEditCommand,
  crewTaskOwners,
  crewTaskSheet,
  type CrewBoardCard,
  type CrewBoardColumn,
  type CrewBoardFace,
  type CrewBoardModel,
  type CrewBoardStatus,
  type CrewNewTaskDraft,
  type CrewPlanCard,
  type CrewTaskSheet,
} from "./CrewBoardPanel.logic";
import { CrewRunDialog } from "./CrewRunDialog";

const EMPTY_COLUMN: Readonly<Record<CrewBoardColumn["id"], string>> = {
  "waiting-on-you": "Nothing waits on you",
  working: "Nobody is on a task",
  "in-review": "Nothing in review",
  queued: "Nothing queued",
  landed: "Nothing landed yet",
};

type OpenSheet = { readonly kind: "task"; readonly taskId: string } | { readonly kind: "new" };

export function CrewBoardPanel({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const { status, snapshot, view, current } = useCrew(environmentId);
  const crewCommand = useCrewCommand(environmentId);
  const router = useRouter();
  const [open, setOpen] = useState<OpenSheet | null>(null);
  const [planEditing, setPlanEditing] = useState(false);
  /** A plan's `planAccept`, waiting for the run dialog to start a run first. */
  const [planToStart, setPlanToStart] = useState<CrewCommand | null>(null);

  if (status === null) return null;
  if (status !== "applied" || snapshot === null || view === null) {
    return <CrewBoardNotice status={status} />;
  }

  const canAct = current && !crewCommand.pending;
  const send = (command: CrewCommand, then?: () => void) => {
    void crewCommand.send(command).then((result) => {
      if (result !== null) then?.();
    });
  };
  const openSheet = (next: OpenSheet) => {
    crewCommand.clearError();
    setOpen(next);
  };
  const closeSheet = () => setOpen(null);
  const openChat = (threadId: ThreadId) => {
    void router.navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
    });
  };

  const sheet = open?.kind === "task" ? crewTaskSheet(snapshot, view, open.taskId) : null;
  const sheetTask =
    sheet === null ? null : (view.tasks.find((row) => row.task.id === sheet.taskId)?.task ?? null);
  // A task that left the board (discarded, or gone from the feed) takes its sheet with it,
  // and the board shows the next failure again.
  const showing = open?.kind === "task" && sheet === null ? null : open;
  const model = crewBoardModel(snapshot, view);

  return (
    <>
      <ScrollArea className="h-full">
        <CrewBoard
          model={model}
          canAct={canAct}
          error={showing === null ? crewCommand.error : null}
          planEditing={planEditing}
          onNewTask={() => openSheet({ kind: "new" })}
          onOpenTask={(taskId) => openSheet({ kind: "task", taskId })}
          onSend={(command) => send(command)}
          onStartPlan={(accept) => (model.runOn ? send(accept) : setPlanToStart(accept))}
          onTogglePlanEditing={() => setPlanEditing((editing) => !editing)}
        />
      </ScrollArea>
      <CrewRunDialog
        environmentId={environmentId}
        open={planToStart !== null}
        onOpenChange={(next) => (next ? undefined : setPlanToStart(null))}
        onStarted={() => {
          if (planToStart !== null) send(planToStart);
        }}
      />
      <Sheet open={sheet !== null} onOpenChange={(next) => (next ? undefined : closeSheet())}>
        <SheetPopup side="right">
          {sheet !== null && sheetTask !== null ? (
            <CrewTaskSheetBody
              key={sheet.taskId}
              sheet={sheet}
              task={sheetTask}
              canAct={canAct}
              error={crewCommand.error}
              onSend={(command) => send(command)}
              onOpenChat={(threadId) => {
                closeSheet();
                openChat(threadId);
              }}
            />
          ) : null}
        </SheetPopup>
      </Sheet>
      <Sheet
        open={showing?.kind === "new"}
        onOpenChange={(next) => (next ? undefined : closeSheet())}
      >
        <SheetPopup side="right">
          {showing?.kind === "new" ? (
            <CrewNewTaskBody
              owners={crewTaskOwners(view)}
              dependencies={crewDependencyOptions(view)}
              canAct={canAct}
              error={crewCommand.error}
              onCreate={(command) => send(command, closeSheet)}
            />
          ) : null}
        </SheetPopup>
      </Sheet>
    </>
  );
}

/** A crew surface that has no board to draw: nothing applied yet, or crew mode off. */
function CrewBoardNotice({ status }: { readonly status: CrewStatus }) {
  return (
    <div className="p-4 text-muted-foreground text-sm" data-crew-board-notice={status}>
      {status === "none"
        ? `${crewRefusalSentence("no-crew", null)} Set one up in the Crew section of the Zerops tab.`
        : crewRefusalSentence("unavailable", null)}
    </div>
  );
}

export interface CrewBoardProps {
  readonly model: CrewBoardModel;
  /** The snapshot is current and nothing of the board's is in flight. */
  readonly canAct: boolean;
  readonly error: string | null;
  readonly planEditing: boolean;
  readonly onNewTask: () => void;
  readonly onOpenTask: (taskId: string) => void;
  readonly onSend: (command: CrewCommand) => void;
  /** The plan's Start, as its `planAccept`: with no run on, a run starts first. */
  readonly onStartPlan: (accept: CrewCommand) => void;
  readonly onTogglePlanEditing: () => void;
}

export function CrewBoard(props: CrewBoardProps) {
  const { model } = props;
  return (
    <div className="@container/board flex flex-col gap-4 p-4" data-crew-board>
      <header className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <MicroLabel>Crew</MicroLabel>
        <span className="min-w-0 truncate font-medium text-sm">{model.header.briefTitle}</span>
        <StatusLine status={model.header.state} />
        <Pill
          className="ms-auto"
          disabled={!props.canAct}
          label="+ New task"
          onClick={props.onNewTask}
          size="sm"
          tone="secondary"
        />
      </header>
      {props.error === null ? null : <ErrorLine text={props.error} />}
      <div className="flex flex-col gap-5 @3xl/board:flex-row @3xl/board:items-start @3xl/board:gap-3">
        {model.columns.map((column) => (
          <section
            className="flex min-w-0 flex-col gap-2 @3xl/board:w-60 @3xl/board:shrink-0"
            data-crew-board-column={column.id}
            key={column.id}
          >
            <h3 className="flex items-baseline gap-1.5 text-muted-foreground text-xs">
              <span className="font-medium text-foreground">{column.title}</span>
              <span className="tabular-nums">{column.count}</span>
            </h3>
            {column.id === "waiting-on-you" && model.plan !== null ? (
              <CrewPlanCardView
                plan={model.plan}
                editing={props.planEditing}
                canAct={props.canAct}
                onOpenTask={props.onOpenTask}
                onSend={props.onSend}
                onStart={props.onStartPlan}
                onToggleEditing={props.onTogglePlanEditing}
              />
            ) : null}
            {column.cards.map((card) => (
              <CrewTaskCard card={card} key={card.taskId} onOpen={props.onOpenTask} />
            ))}
            {column.count === 0 ? (
              <p className="text-muted-foreground text-xs">{EMPTY_COLUMN[column.id]}</p>
            ) : null}
          </section>
        ))}
      </div>
    </div>
  );
}

function StatusLine({ status }: { readonly status: CrewBoardStatus }) {
  return <StatusDot label={status.word} pulse={status.pulse} sentence tone={status.tone} />;
}

function ErrorLine({ text }: { readonly text: string }) {
  return (
    <p className="text-destructive-foreground text-xs" role="alert">
      {text}
    </p>
  );
}

function OwnerTag({ owner }: { readonly owner: CrewBoardFace }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {owner.tint === null ? null : <MateFace size="dot" state={owner.face} tint={owner.tint} />}
      <span className="truncate">@{owner.handle}</span>
    </span>
  );
}

function CrewTaskCard({
  card,
  onOpen,
}: {
  readonly card: CrewBoardCard;
  readonly onOpen: (taskId: string) => void;
}) {
  return (
    <button
      className="w-full cursor-pointer rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-crew-task={card.number}
      onClick={() => onOpen(card.taskId)}
      type="button"
    >
      <FlatCard className="flex flex-col gap-1.5 px-3 py-2.5 text-xs transition-colors hover:bg-accent/60">
        <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
          <span className="shrink-0 tabular-nums">#{card.number}</span>
          <OwnerTag owner={card.owner} />
        </span>
        <span className="font-medium text-foreground text-sm">{card.title}</span>
        {card.status === null ? null : <StatusLine status={card.status} />}
        <span className="text-muted-foreground">{card.detail}</span>
      </FlatCard>
    </button>
  );
}

function CrewPlanCardView(props: {
  readonly plan: CrewPlanCard;
  readonly editing: boolean;
  readonly canAct: boolean;
  readonly onOpenTask: (taskId: string) => void;
  readonly onSend: (command: CrewCommand) => void;
  readonly onStart: (accept: CrewCommand) => void;
  readonly onToggleEditing: () => void;
}) {
  const { plan } = props;
  const taskIds = plan.rows.map((row) => row.taskId);
  const discardRows = (ids: ReadonlyArray<string>) => {
    const command = crewPlanCommand("planDiscard", ids);
    if (command !== null) props.onSend(command);
  };
  const accept = crewPlanCommand("planAccept", taskIds);
  return (
    <FlatCard className="flex flex-col gap-2 px-3 py-2.5 text-xs" data-crew-plan>
      <span className="font-medium text-foreground text-sm">{plan.title}</span>
      {plan.sentence === null ? null : (
        <span className="text-muted-foreground">{plan.sentence}</span>
      )}
      <ul className="flex flex-col gap-1">
        {plan.rows.map((row) => (
          <li
            className="flex min-w-0 items-center gap-2"
            data-crew-plan-row={row.number}
            key={row.taskId}
          >
            {row.owner.tint === null ? null : (
              <MateFace size="dot" state={row.owner.face} tint={row.owner.tint} />
            )}
            {props.editing ? (
              <button
                className="min-w-0 flex-1 cursor-pointer truncate text-left underline-offset-2 hover:underline"
                onClick={() => props.onOpenTask(row.taskId)}
                type="button"
              >
                {row.title}
              </button>
            ) : (
              <span className="min-w-0 flex-1 truncate">{row.title}</span>
            )}
            {row.after === null ? null : (
              <span className="shrink-0 text-muted-foreground">{row.after}</span>
            )}
            {props.editing ? (
              <button
                aria-label={`Remove #${row.number} from the plan`}
                className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-64"
                disabled={!props.canAct}
                onClick={() => discardRows([row.taskId])}
                type="button"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Pill
          disabled={!props.canAct}
          label="Start"
          onClick={() => {
            if (accept !== null) props.onStart(accept);
          }}
          size="sm"
        />
        <Pill
          aria-pressed={props.editing}
          label="Edit"
          onClick={props.onToggleEditing}
          size="sm"
          tone="outline"
        />
        <Pill
          disabled={!props.canAct}
          label="Discard"
          onClick={() => discardRows(taskIds)}
          size="sm"
          tone="outline"
        />
      </div>
    </FlatCard>
  );
}

function SheetSection({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1">
      <MicroLabel>{label}</MicroLabel>
      <div className="text-sm">{children}</div>
    </section>
  );
}

export function CrewTaskSheetBody(props: {
  readonly sheet: CrewTaskSheet;
  readonly task: CrewTask;
  readonly canAct: boolean;
  readonly error: string | null;
  readonly onSend: (command: CrewCommand) => void;
  readonly onOpenChat: (threadId: ThreadId) => void;
}) {
  const { sheet, task } = props;
  const [draft, setDraft] = useState<{
    readonly title: string;
    readonly brief: string;
    readonly doneWhen: string;
  } | null>(null);
  const editCommand = draft === null ? null : crewTaskEditCommand(task, draft);
  const ownerThreadId = sheet.ownerThreadId;

  return (
    <>
      <SheetHeader>
        <SheetTitle className="me-8">{sheet.heading}</SheetTitle>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
          <span className="inline-flex items-center gap-1.5">
            {sheet.owner.tint === null ? null : (
              <MateFace size="dot" state={sheet.owner.face} tint={sheet.owner.tint} />
            )}
            {sheet.owner.name}
          </span>
          {sheet.status === null ? null : <StatusLine status={sheet.status} />}
          <span>{sheet.source}</span>
        </div>
      </SheetHeader>
      <div
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6"
        data-crew-task-sheet
      >
        {draft === null ? (
          <>
            <SheetSection label="Brief">
              <p className="whitespace-pre-wrap">{sheet.brief}</p>
            </SheetSection>
            {sheet.doneWhen === null ? null : (
              <SheetSection label="Done when">
                <p className="whitespace-pre-wrap">{sheet.doneWhen}</p>
              </SheetSection>
            )}
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="crew-task-title">Title</Label>
              <Input
                id="crew-task-title"
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                value={draft.title}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="crew-task-brief">Brief</Label>
              <Textarea
                id="crew-task-brief"
                onChange={(event) => setDraft({ ...draft, brief: event.target.value })}
                value={draft.brief}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="crew-task-done-when">Done when</Label>
              <Textarea
                id="crew-task-done-when"
                onChange={(event) => setDraft({ ...draft, doneWhen: event.target.value })}
                value={draft.doneWhen}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Pill
                disabled={!props.canAct || draft.title.trim() === ""}
                label="Save"
                onClick={() => {
                  if (editCommand !== null) props.onSend(editCommand);
                  setDraft(null);
                }}
                size="sm"
              />
              <Pill label="Cancel" onClick={() => setDraft(null)} size="sm" tone="outline" />
            </div>
          </div>
        )}
        <SheetSection label="Attempts">
          <span className="flex flex-wrap items-center gap-x-2">
            <span>{sheet.attempts}</span>
            {ownerThreadId === null ? null : (
              <button
                className="cursor-pointer text-message-action underline-offset-2 hover:underline"
                onClick={() => props.onOpenChat(ownerThreadId)}
                type="button"
              >
                {`Open ${sheet.owner.name}'s chat`}
              </button>
            )}
          </span>
        </SheetSection>
        {sheet.report === null ? null : (
          <SheetSection label="Report">
            <p className="whitespace-pre-wrap">{sheet.report}</p>
          </SheetSection>
        )}
        {sheet.check === null ? null : (
          <SheetSection label="Check">
            <StatusDot label={sheet.check.word} sentence tone={sheet.check.tone} />
            {sheet.check.output === "" ? null : (
              <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2 font-mono text-xs">
                {sheet.check.output}
              </pre>
            )}
          </SheetSection>
        )}
        {sheet.review === null ? null : (
          <SheetSection label="Review">
            <p>{sheet.review}</p>
          </SheetSection>
        )}
        {sheet.changes === null ? null : (
          <SheetSection label="Changes">
            <span className="tabular-nums">{sheet.changes}</span>
          </SheetSection>
        )}
        {sheet.landedCommit === null ? null : (
          <SheetSection label="Landed as">
            <code className="font-mono text-xs">{sheet.landedCommit}</code>
          </SheetSection>
        )}
        {props.error === null ? null : <ErrorLine text={props.error} />}
        {sheet.actions.length === 0 && !sheet.editable ? null : (
          <div className="flex flex-wrap gap-2" data-crew-task-actions>
            {sheet.actions.map((action) => (
              <Pill
                disabled={!props.canAct}
                key={action.command._tag}
                label={action.label}
                onClick={() => props.onSend(action.command)}
                size="sm"
                tone={action.tone}
              />
            ))}
            {sheet.editable && draft === null ? (
              <Pill
                label="Edit"
                onClick={() =>
                  setDraft({ title: task.title, brief: task.brief, doneWhen: task.doneWhen })
                }
                size="sm"
                tone="outline"
              />
            ) : null}
          </div>
        )}
      </div>
    </>
  );
}

export function CrewNewTaskBody(props: {
  /** The owner to start with: a crewmate's chat asks for a task of its own. */
  readonly owner?: string | undefined;
  readonly owners: ReadonlyArray<CrewBoardFace>;
  readonly dependencies: ReadonlyArray<{ readonly taskId: string; readonly label: string }>;
  readonly canAct: boolean;
  readonly error: string | null;
  readonly onCreate: (command: CrewCommand) => void;
}) {
  const [draft, setDraft] = useState<CrewNewTaskDraft>({
    owner: props.owner ?? null,
    title: "",
    brief: "",
    doneWhen: "",
    dependsOn: [],
  });
  const command = crewNewTaskCommand(draft);
  const ownerName = props.owners.find((owner) => owner.handle === draft.owner)?.name;

  return (
    <>
      <SheetHeader>
        <SheetTitle>New task</SheetTitle>
      </SheetHeader>
      <div
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 pb-6"
        data-crew-new-task
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="crew-new-task-owner">Owner</Label>
          <Select
            onValueChange={(value) => setDraft({ ...draft, owner: value })}
            value={draft.owner}
          >
            <SelectTrigger aria-label="Owner" id="crew-new-task-owner">
              <SelectValue placeholder="Choose a crewmate">
                {ownerName ?? "Choose a crewmate"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {props.owners.map((owner) => (
                <SelectItem key={owner.handle} value={owner.handle}>
                  {`${owner.name} · @${owner.handle}`}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="crew-new-task-title">Title</Label>
          <Input
            id="crew-new-task-title"
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            value={draft.title}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="crew-new-task-brief">Brief</Label>
          <Textarea
            id="crew-new-task-brief"
            onChange={(event) => setDraft({ ...draft, brief: event.target.value })}
            value={draft.brief}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="crew-new-task-done-when">Done when</Label>
          <Textarea
            id="crew-new-task-done-when"
            onChange={(event) => setDraft({ ...draft, doneWhen: event.target.value })}
            value={draft.doneWhen}
          />
        </div>
        {props.dependencies.length === 0 ? null : (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 font-medium text-sm">Depends on</legend>
            {props.dependencies.map((dependency) => (
              <Label key={dependency.taskId}>
                <Checkbox
                  checked={draft.dependsOn.includes(dependency.taskId)}
                  onCheckedChange={(checked) =>
                    setDraft({
                      ...draft,
                      dependsOn: checked
                        ? [...draft.dependsOn, dependency.taskId]
                        : draft.dependsOn.filter((taskId) => taskId !== dependency.taskId),
                    })
                  }
                />
                <span className="min-w-0 truncate">{dependency.label}</span>
              </Label>
            ))}
          </fieldset>
        )}
        {props.error === null ? null : <ErrorLine text={props.error} />}
        <div>
          <Pill
            disabled={!props.canAct || command === null}
            label="Create task"
            onClick={() => {
              if (command !== null) props.onCreate(command);
            }}
            size="sm"
          />
        </div>
      </div>
    </>
  );
}
