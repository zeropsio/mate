/** The Projects view: every group as a card, its four steps side by side. */

import { PlusIcon } from "lucide-react";
import { Fragment, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { FlatCard, MicroLabel, StatusDot } from "../primitives";
import {
  drawn,
  GroupName,
  MainStep,
  mergesHere,
  PreviewLink,
  ProductionStep,
  releaseVerbFor,
} from "./flowSteps";
import {
  groupMetaLine,
  nextStepCell,
  nextStepTone,
  pullRequestsLine,
  type FlowCell,
} from "./projectsView.logic";
import type { ProjectsFlowGroup, ZeropsProjectsFlowProps } from "./ZeropsProjectsFlow";

/**
 * The four steps. Wide: one row of labels over one row of equal cells, arrows
 * between. Medium: two by two, each grid row's cells equal. Narrow: a label
 * and value list, hairlines between. Each step is a subgrid over its label
 * and its cell, so a row's cells share one height.
 */
const STEPS_GRID_CLASS =
  "grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 @2xl/flow:grid-cols-2 @2xl/flow:gap-y-1.5 @5xl/flow:grid-cols-[minmax(0,1.3fr)_1rem_minmax(0,1fr)_1rem_minmax(0,1fr)_1rem_minmax(0,1fr)] @5xl/flow:grid-rows-[auto_1fr] @5xl/flow:gap-x-0";

const EMPTY_WORD_CLASS = "text-sm font-normal text-muted-foreground";

function Step({
  label,
  name,
  placement,
  add,
  children,
}: {
  readonly label: string;
  readonly name: FlowCell;
  readonly placement: string;
  /** A verb that adds to the step, beside its label. */
  readonly add?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "col-span-2 grid grid-cols-subgrid items-start border-b border-border/50 py-2 last:border-b-0 @2xl/flow:col-span-1 @2xl/flow:row-span-2 @2xl/flow:grid-cols-1 @2xl/flow:grid-rows-subgrid @2xl/flow:gap-y-1.5 @2xl/flow:border-b-0 @2xl/flow:py-0",
        placement,
      )}
      data-zerops-step={name}
    >
      <span className="flex h-6 min-w-0 items-center gap-1">
        <MicroLabel className="text-muted-foreground">{label}</MicroLabel>
        {add}
      </span>
      <div
        className="flex min-w-0 flex-col gap-1.5 @2xl/flow:min-h-16 @2xl/flow:self-stretch @2xl/flow:rounded-lg @2xl/flow:bg-muted/50 @2xl/flow:px-3 @2xl/flow:py-2.5"
        data-zerops-step-cell={name}
      >
        {children}
      </div>
    </div>
  );
}

/** Add Mate: a quiet "+" beside the Mates label, disabled while a creation runs. */
function AddMate({
  name,
  creating,
  onAdd,
}: {
  readonly name: string;
  readonly creating: boolean;
  readonly onAdd: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label={`Add a Mate to ${name}`}
            className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
            data-zerops-surface="add-mate"
            disabled={creating}
            onClick={onAdd}
            type="button"
          />
        }
      >
        <PlusIcon aria-hidden="true" className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup>Add Mate</TooltipPopup>
    </Tooltip>
  );
}

function Arrow({ placement }: { readonly placement: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "hidden self-center justify-self-center text-xs text-muted-foreground/60 @5xl/flow:row-start-2 @5xl/flow:block",
        placement,
      )}
    >
      →
    </span>
  );
}

export function ProjectCard<T>({
  entry,
  props,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly props: ZeropsProjectsFlowProps<T>;
}) {
  const { flow, group } = entry;
  const stopMenu = (projectId: string) => {
    const item = entry.stops.get(projectId)?.item;
    return item === undefined ? null : props.renderStopMenu(item);
  };
  const { production } = flow;
  const groupRows = props.renderGroupRows(group);
  const offered = props.addsOffered?.(group) ?? true;
  const { onCreateEnvironment } = props;
  const cell = nextStepCell(flow);
  // The verb keeps its own width, at the right of the thing it acts on.
  const verbIn = (where: FlowCell) =>
    cell === where ? (
      <span className="flex shrink-0 items-center">{props.renderNextStep(entry)}</span>
    ) : null;
  return (
    <FlatCard
      className="flex scroll-mt-4 flex-col gap-3 p-4"
      data-zerops-group={group.groupId}
      id={`project-${group.groupId}`}
    >
      <header className="flex h-8 min-w-0 items-center gap-3">
        <h2 className="min-w-0 shrink-0">
          <GroupName className="block text-base" entry={entry} />
        </h2>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {[groupMetaLine(flow), entry.line].filter((part) => part !== undefined).join(" · ")}
        </span>
        {/* The step, named; its verb is in the step it acts on, once. */}
        {flow.nextStep.kind === "none" || flow.nextStep.kind === "first-task" ? null : (
          <StatusDot
            className="min-w-0 shrink text-xs"
            label={flow.nextStep.text}
            sentence
            tone={nextStepTone(flow.nextStep.kind)}
          />
        )}
        {props.renderGroupMenu(group)}
      </header>
      <div className={STEPS_GRID_CLASS}>
        <Step
          add={
            onCreateEnvironment === undefined || !offered ? null : (
              <AddMate
                creating={props.creating ?? false}
                name={group.name}
                onAdd={() => onCreateEnvironment(group.groupId, "dev")}
              />
            )
          }
          label="Mates"
          name="mates"
          placement="@5xl/flow:col-start-1"
        >
          <div className="flex min-w-0 items-start gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              {entry.mates.map((item, index) => {
                const preview = flow.mates[index]?.preview;
                return (
                  <div className="flex min-w-0 flex-col gap-1" key={props.getKey(item)}>
                    {props.renderMate(item)}
                    {preview === undefined ? null : <PreviewLink url={preview} />}
                  </div>
                );
              })}
              {entry.mates.length === 0 ? (
                <span className={EMPTY_WORD_CLASS}>No Mate yet</span>
              ) : null}
            </div>
            {verbIn("mates")}
          </div>
        </Step>
        <Arrow placement="@5xl/flow:col-start-2" />
        <Step label="Pull requests" name="pull-requests" placement="@5xl/flow:col-start-3">
          <div className="flex min-w-0 items-start gap-2">
            {flow.pullRequests.length === 0 ? (
              <span className={cn(EMPTY_WORD_CLASS, "flex-1")}>{pullRequestsLine(flow)}</span>
            ) : (
              <ul className="flex min-w-0 flex-1 flex-col divide-y divide-border/50">
                {flow.pullRequests.map(({ pull }) => (
                  <Fragment key={`${pull.repository}#${String(pull.number)}`}>
                    {props.renderPullRequest(group, pull, {
                      withMerge: !mergesHere(flow, pull),
                      compact: true,
                    })}
                  </Fragment>
                ))}
              </ul>
            )}
            {verbIn("pull-requests")}
          </div>
        </Step>
        <Arrow placement="@5xl/flow:col-start-4" />
        <Step
          label="main"
          name="main"
          placement="@2xl/flow:mt-2 @5xl/flow:col-start-5 @5xl/flow:mt-0"
        >
          <MainStep density="box" entry={entry} menuFor={stopMenu} verb={verbIn("main")} />
        </Step>
        <Arrow placement="@5xl/flow:col-start-6" />
        <Step
          label="Production"
          name="production"
          placement="@2xl/flow:mt-2 @5xl/flow:col-start-7 @5xl/flow:mt-0"
        >
          <ProductionStep
            density="box"
            entry={entry}
            menu={production.kind === "absent" ? null : stopMenu(production.stop.projectId)}
            releaseVerb={releaseVerbFor(entry, props.renderReleaseVerb)}
            verb={verbIn("production")}
          />
        </Step>
      </div>
      {/* The steps' own rows: the other environments, then what a release
          would carry and the gate's reason. Nothing else goes under the steps. */}
      {entry.others.length > 0 || drawn(groupRows) ? (
        <ul
          className="flex flex-col divide-y divide-border/50 border-t border-border/50 pt-2"
          data-zerops-surface="environment-rows"
        >
          {entry.others.map(({ item, role }) => (
            <Fragment key={props.getKey(item)}>{props.renderEnvironment(item, role)}</Fragment>
          ))}
          {groupRows}
        </ul>
      ) : null}
    </FlatCard>
  );
}
