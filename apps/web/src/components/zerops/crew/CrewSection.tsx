/**
 * The crew's section, at the top of the Crew tab (PRD §4.3): the crew's
 * summary and its controls. `CrewSectionEmpty` is the `none` state;
 * `CrewSection` the `applied` one, top to bottom — header and state, run
 * meters (C), the brief, *Waiting on you*, the crewmates, add, *Tell the
 * crew*, and the footer.
 *
 * Presentational: every press is a callback, so the host
 * (`CrewSectionHost`) owns the commands, the sheets and the navigation. A (C)
 * element renders only while the snapshot has a lead or a run — never
 * disabled in its stead.
 */
import {
  CREW_BOARD_COLUMNS,
  CREW_CREWMATES_WORD,
  CREW_LEAD_WORD,
  crewAttentionSentence,
  crewLandedWord,
  crewLaneWord,
  crewNamingTheMate,
  crewPendingWord,
  crewPortsOffWord,
  crewRunMeters,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewmateView, CrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import { mateMarkStateForThreadStatus } from "@t3tools/shared/threadStatus";
import type {
  CrewAttention,
  CrewCommand,
  CrewCommandResult,
  CrewHost,
  CrewSnapshot,
  EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import { EllipsisIcon, ExternalLinkIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useOpenReview } from "~/zerops/review";

import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../../ui/menu";
import { Chip, FlatCard, MateFace, MicroLabel, Pill, StatusDot } from "../primitives";
import {
  CREW_ORIGIN,
  crewAttentionActions,
  crewBriefLine,
  crewLoginMark,
  crewOffersStart,
  crewRowLead,
  crewRowState,
  crewServedLine,
  crewStateTone,
} from "./CrewSection.logic";
import { crewResumeNeedsDialog } from "./CrewRunDialog.logic";
import { CrewTellComposer } from "./CrewTellComposer";

const WAITING_ON_YOU = CREW_BOARD_COLUMNS[0].title;

export function CrewSectionEmpty({ onSetUp }: { readonly onSetUp: () => void }) {
  return (
    <FlatCard className="space-y-3 p-4" data-crew-section="none">
      <MicroLabel>Crew</MicroLabel>
      <p className="text-sm text-muted-foreground">
        Named crewmates, each with its own job and its own copy of the code. You review and land
        their work into your tree.
      </p>
      <Pill label="Set up a crew" onClick={onSetUp} size="sm" />
    </FlatCard>
  );
}

export interface CrewSectionProps {
  readonly environmentId: EnvironmentId;
  /** Your tree, where *Tell the crew*'s `@` finds files; `null` while unread. */
  readonly treeCwd: string | null;
  readonly view: CrewView;
  readonly snapshot: CrewSnapshot;
  /** Sends one press; its result, or `null` when it was refused. */
  /** Sends one press; `origin` (`CREW_ORIGIN`) is where its refusal shows. */
  readonly send: (command: CrewCommand, origin?: string) => Promise<CrewCommandResult | null>;
  readonly pending: boolean;
  /** The last refusal's sentence at `origin`; `null` asks for one no row owns. */
  readonly errorAt: (origin: string | null) => string | null;
  /** The Mate who lives here, named where the engine's words say "your Mate". */
  readonly mateName: string;
  /** *Tell the crew*'s own sends, so its refusal stays under its line. */
  readonly tell: {
    readonly send: (command: CrewCommand) => Promise<CrewCommandResult | null>;
    readonly pending: boolean;
    readonly error: string | null;
  };
  readonly onOpenThread: (threadId: ThreadId) => void;
  /** Brings the board under the section into view; `null` while there is none. */
  readonly onShowBoard: (() => void) | null;
  readonly onEditBrief: () => void;
  /** `null` adds a crewmate. */
  readonly onEditCrewmate: (handle: string | null) => void;
  /** (C) Adds the lead. */
  readonly onAddLead: () => void;
  /** (C) Opens the run dialog. */
  readonly onStartRun: () => void;
  /** Opens the run dialog to resume a run its budget or time limit paused, with new limits. */
  readonly onResumeRun: () => void;
  readonly onStartFresh: (row: CrewmateView) => void;
  readonly onRemove: (row: CrewmateView) => void;
  /** Hands Fen a draft, confirmed first: `what` says why. */
  readonly onAsk: (ask: string, what: string) => void;
  readonly onDeliver: () => void;
  readonly onAddCrewPorts: (host: string) => void;
}

export function CrewSection(unnamed: CrewSectionProps) {
  // Every refusal and engine failure this section shows names the Mate.
  const props: CrewSectionProps = {
    ...unnamed,
    errorAt: (origin) => {
      const words = unnamed.errorAt(origin);
      return words === null ? null : crewNamingTheMate(words, unnamed.mateName);
    },
  };
  const { view, snapshot } = props;
  const run = snapshot.run;
  const runOn = run !== null && (run.state === "running" || run.state === "paused");
  return (
    <section className="space-y-4" data-crew-section="applied">
      <CrewHeader {...props} runOn={runOn} />
      {(
        [
          [
            "engine",
            snapshot.lastError === null
              ? null
              : crewNamingTheMate(snapshot.lastError, props.mateName),
          ],
          ["press", props.errorAt(null)],
        ] as const
      ).map(([source, line]) =>
        line === null ? null : (
          <p className="text-xs text-status-failed-text" key={source} role="alert">
            {line}
          </p>
        ),
      )}
      {view.crew === null ? null : <CrewBriefRow {...props} />}
      {snapshot.attention.length === 0 ? null : <CrewAttentionBlock {...props} />}
      {view.lead === null ? null : (
        <div className="space-y-1" data-crew-lead>
          <MicroLabel>{CREW_LEAD_WORD}</MicroLabel>
          <ul>
            <CrewmateRow {...props} row={view.lead} />
          </ul>
        </div>
      )}
      <div className="space-y-1" data-crew-rows>
        <MicroLabel>{CREW_CREWMATES_WORD}</MicroLabel>
        <ul className="space-y-1">
          {view.crewmates
            .filter((row) => row !== view.lead)
            .map((row) => (
              <CrewmateRow key={row.crewmate.handle} {...props} row={row} />
            ))}
        </ul>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => props.onEditCrewmate(null)} size="xs" variant="ghost">
          + Add crewmate
        </Button>
        {view.lead === null ? (
          <Button onClick={props.onAddLead} size="xs" variant="ghost">
            + Add lead
          </Button>
        ) : null}
      </div>
      <CrewTellComposer
        crewmates={snapshot.crewmates}
        environmentId={props.environmentId}
        treeCwd={props.treeCwd}
        error={props.tell.error}
        hasLead={view.lead !== null}
        onSend={async (command) => (await props.tell.send(command)) !== null}
        sending={props.tell.pending}
      />
      <CrewFooter {...props} />
    </section>
  );
}

/** The Brief row: its version, its first lines as plain text — or, still the template's, a prompt. */
function CrewBriefRow(props: CrewSectionProps) {
  const crew = props.view.crew;
  if (crew === null) return null;
  const line = crewBriefLine(crew);
  return (
    <FlatCard className="space-y-1.5 p-3" data-crew-brief>
      <div className="flex items-center gap-2">
        <MicroLabel>Brief</MicroLabel>
        <Chip label={`v${crew.briefVersion}`} tone="off" />
        <Button className="ms-auto" onClick={props.onEditBrief} size="xs" variant="ghost">
          Edit
        </Button>
      </div>
      {line.placeholder ? (
        <p className="text-sm text-muted-foreground italic" data-crew-brief-placeholder>
          {line.text}
        </p>
      ) : (
        <p className="line-clamp-2 text-sm whitespace-pre-line text-muted-foreground">
          {line.text}
        </p>
      )}
    </FlatCard>
  );
}

function CrewHeader(props: CrewSectionProps & { readonly runOn: boolean }) {
  const { view, snapshot, send } = props;
  const run = snapshot.run;
  const meters = run !== null && props.runOn ? crewRunMeters(run) : null;
  return (
    <div className="space-y-2">
      <div className="flex min-w-0 items-center gap-2">
        <MicroLabel>Crew</MicroLabel>
        {view.crew === null ? null : (
          <span className="min-w-0 truncate text-sm font-medium text-foreground">
            {view.crew.briefTitle}
          </span>
        )}
        <StatusDot
          className="shrink-0 text-xs text-muted-foreground"
          label={view.stateWord}
          sentence
          tone={crewStateTone({ run, workingCount: view.workingCount })}
        />
        {run === null || !props.runOn ? null : (
          <div className="ms-auto flex shrink-0 gap-1.5">
            {run.state === "running" ? (
              <Pill
                label="Pause"
                onClick={() => void send({ _tag: "pause", runId: run.id }, CREW_ORIGIN.run)}
                size="sm"
                tone="outline"
              />
            ) : (
              <Pill
                label="Resume"
                onClick={() =>
                  crewResumeNeedsDialog(run)
                    ? props.onResumeRun()
                    : void send({ _tag: "resume", runId: run.id }, CREW_ORIGIN.run)
                }
                size="sm"
                tone="outline"
              />
            )}
            <Pill
              label="Stop"
              onClick={() => void send({ _tag: "stop", runId: run.id }, CREW_ORIGIN.run)}
              size="sm"
              tone="outline"
            />
          </div>
        )}
        {crewOffersStart(view, run) ? (
          <Pill
            className="ms-auto shrink-0"
            label="Start run"
            onClick={props.onStartRun}
            size="sm"
          />
        ) : null}
      </div>
      {meters === null ? null : (
        <p className="text-xs text-muted-foreground tabular-nums" data-crew-run-meters>
          {[meters.spend, meters.time, meters.usage].filter((meter) => meter !== null).join(" · ")}
        </p>
      )}
      <CrewPressError message={props.errorAt(CREW_ORIGIN.run)} />
    </div>
  );
}

function CrewAttentionBlock(props: CrewSectionProps) {
  const { snapshot } = props;
  return (
    <FlatCard className="space-y-1 p-3" data-crew-attention>
      <MicroLabel>{`${WAITING_ON_YOU} · ${snapshot.attention.length}`}</MicroLabel>
      <ul className="divide-y divide-border">
        {snapshot.attention.map((row) => (
          <CrewAttentionRow key={row.id} {...props} row={row} />
        ))}
      </ul>
    </FlatCard>
  );
}

function CrewAttentionRow(props: CrewSectionProps & { readonly row: CrewAttention }) {
  const { row, snapshot, send } = props;
  const openReview = useOpenReview();
  const [answering, setAnswering] = useState(false);
  const [answer, setAnswer] = useState("");
  const sentence = crewAttentionSentence(row, snapshot);
  const actions = crewAttentionActions(row, snapshot, { board: props.onShowBoard !== null });
  const submitAnswer = () => {
    const text = answer.trim();
    if (text === "" || row.handle === null) return;
    void send(
      { _tag: "answer", handle: row.handle, taskId: row.taskId, text },
      CREW_ORIGIN.attention(row.id),
    ).then((result) => {
      if (result === null) return;
      setAnswer("");
      setAnswering(false);
    });
  };
  return (
    <li className="space-y-2 py-2">
      <div className="flex min-w-0 items-start gap-3">
        <p className="min-w-0 flex-1 text-sm text-foreground">{sentence}</p>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {actions.map((action) => (
            <Pill
              key={action.label}
              label={action.label}
              onClick={(event) => {
                switch (action.kind) {
                  case "answer":
                    setAnswering(true);
                    return;
                  case "review":
                    openReview(
                      {
                        kind: "crew-task",
                        environmentId: props.environmentId,
                        taskId: action.taskId,
                      },
                      { from: event.currentTarget },
                    );
                    return;
                  case "ask":
                    props.onAsk(action.ask, sentence);
                    return;
                  case "board":
                    props.onShowBoard?.();
                    return;
                  case "chat":
                    props.onOpenThread(action.threadId);
                    return;
                  case "command":
                    void send(action.command, CREW_ORIGIN.attention(row.id));
                    return;
                }
              }}
              size="sm"
              tone={action.kind === "ask" || action.kind === "board" ? "outline" : "primary"}
            />
          ))}
        </div>
      </div>
      <CrewPressError message={props.errorAt(CREW_ORIGIN.attention(row.id))} />
      {answering ? (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            submitAnswer();
          }}
        >
          <div className="min-w-0 flex-1">
            <Input
              aria-label={sentence}
              autoFocus
              onChange={(event) => setAnswer(event.target.value)}
              size="sm"
              value={answer}
            />
          </div>
          <Pill
            disabled={answer.trim() === "" || props.pending}
            label="Send"
            size="sm"
            type="submit"
          />
        </form>
      ) : null}
    </li>
  );
}

function CrewmateRow(props: CrewSectionProps & { readonly row: CrewmateView }) {
  const { row, view } = props;
  const mate = row.crewmate;
  const state = crewRowState(row, view.tasks);
  const lead = crewRowLead(row);
  const lane = mate.lane === null ? null : crewLaneWord(mate.lane);
  const pending = row.pending === null ? null : crewPendingWord(row.pending);
  const loginMark = crewLoginMark(mate.login);
  const threadId = mate.currentThreadId;
  const face = row.status === null ? "idle" : mateMarkStateForThreadStatus(row.status.kind);
  const body: ReactNode = (
    <>
      <MateFace size="sm" state={face} tint={mate.tint} />
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-sm font-medium text-foreground">{mate.displayName}</span>
          {mate.kind === "lead" ? (
            <Chip className="shrink-0" data-crew-lead-chip label={CREW_LEAD_WORD} tone="off" />
          ) : null}
          <span className="shrink-0 text-xs text-muted-foreground">@{mate.handle}</span>
          {loginMark === null ? null : (
            <span className="shrink-0 text-xs text-muted-foreground">· {loginMark}</span>
          )}
        </span>
        {lead.kind === "task" ? (
          <Chip className="max-w-full truncate normal-case" label={lead.text} tone="busy" />
        ) : (
          <span className="block truncate text-xs text-muted-foreground">{lead.text}</span>
        )}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <StatusDot
          className="text-xs text-muted-foreground"
          label={state.word}
          pulse={state.pulse}
          sentence
          tone={state.tone}
        />
        {lane === null ? null : <span className="text-xs text-muted-foreground">{lane}</span>}
        {pending === null ? null : <Chip label={pending} tone="attention" />}
      </span>
    </>
  );
  return (
    <li className="space-y-1" data-crewmate={mate.handle}>
      <div className="flex min-w-0 items-center gap-1">
        {threadId === null ? (
          <div className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-2">{body}</div>
        ) : (
          <button
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted"
            onClick={() => props.onOpenThread(threadId)}
            type="button"
          >
            {body}
          </button>
        )}
        {mate.app?.state === "running" && mate.app.url !== null ? (
          <a
            aria-label={`Open ${mate.displayName}'s app`}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
            href={mate.app.url}
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLinkIcon className="size-3.5" />
          </a>
        ) : null}
        <Menu>
          <MenuTrigger
            render={
              <Button
                aria-label={`${mate.displayName}'s actions`}
                size="icon-xs"
                variant="ghost-muted"
              />
            }
          >
            <EllipsisIcon className="size-4" />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem onClick={() => props.onEditCrewmate(mate.handle)}>Edit job</MenuItem>
            <MenuItem onClick={() => props.onStartFresh(row)}>Start fresh</MenuItem>
            <MenuItem onClick={() => props.onRemove(row)}>Remove from crew</MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      <CrewPressError message={props.errorAt(CREW_ORIGIN.crewmate(mate.handle))} />
    </li>
  );
}

/** A refused press, said beside the row or button it came from. */
function CrewPressError({ message }: { readonly message: string | null }) {
  return message === null ? null : (
    <p className="text-xs text-status-failed-text" role="alert">
      {message}
    </p>
  );
}

/**
 * What your tree's dev services serve and what waits to go out — nothing at
 * all where neither has anything to say: a crew without a writer has no dev
 * service, and the board it used to link to stands right under the section.
 */
function CrewFooter(props: CrewSectionProps) {
  const { snapshot, send } = props;
  const hosts = snapshot.hosts.filter(
    (host) =>
      crewServedLine(host, snapshot.crewmates) !== null ||
      host.crewPorts.length === 0 ||
      props.errorAt(CREW_ORIGIN.host(host.host)) !== null,
  );
  const deliverError = props.errorAt(CREW_ORIGIN.deliver);
  if (hosts.length === 0 && snapshot.landedNotDelivered === 0 && deliverError === null) {
    return null;
  }
  return (
    <div
      className="space-y-1.5 border-t border-border pt-3 text-xs text-muted-foreground"
      data-crew-footer
    >
      {hosts.map((host) => (
        <CrewHostLine host={host} key={host.host} {...props} send={send} />
      ))}
      {snapshot.landedNotDelivered === 0 ? null : (
        <div className="flex items-center gap-2">
          <span>{crewLandedWord(snapshot.landedNotDelivered)}</span>
          <Pill className="ms-auto" label="Deliver" onClick={props.onDeliver} size="sm" />
        </div>
      )}
      <CrewPressError message={deliverError} />
    </div>
  );
}

function CrewHostLine(props: CrewSectionProps & { readonly host: CrewHost }) {
  const { host, snapshot, send } = props;
  const served = crewServedLine(host, snapshot.crewmates);
  return (
    <div className="space-y-1" data-crew-host={host.host}>
      <CrewPressError message={props.errorAt(CREW_ORIGIN.host(host.host))} />
      {served === null ? null : (
        <div className="flex items-center gap-2">
          <span className="min-w-0 truncate">{served.text}</span>
          {served.release ? (
            <Button
              className="ms-auto"
              onClick={() =>
                void send({ _tag: "claimRelease", host: host.host }, CREW_ORIGIN.host(host.host))
              }
              size="xs"
              variant="ghost"
            >
              Back to my tree
            </Button>
          ) : null}
        </div>
      )}
      {host.crewPorts.length > 0 ? null : (
        <div className="flex items-center gap-2">
          <span className="min-w-0 truncate">{crewPortsOffWord(host.host)}</span>
          <Button
            className="ms-auto"
            onClick={() => props.onAddCrewPorts(host.host)}
            size="xs"
            variant="ghost"
          >
            Add crew ports
          </Button>
        </div>
      )}
    </div>
  );
}
