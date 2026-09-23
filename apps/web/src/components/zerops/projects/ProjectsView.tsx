/** The Projects view: every group as a card, its four steps side by side. */

import type { FlowPullRequest, ZeropsEnvironmentRole } from "@t3tools/client-runtime/zerops";
import { Fragment } from "react";

import { cn } from "~/lib/utils";
import { MicroLabel, StatusDot } from "../primitives";
import {
  drawn,
  EMPTY_STEP_CLASS,
  GroupName,
  MainStep,
  PreviewLink,
  ProductionStep,
  QUIET_BUTTON_CLASS,
  STEP_BOX_CLASS,
} from "./flowSteps";
import { groupMetaLine, nextStepTone, pullRequestsLine } from "./projectsView.logic";
import type { ProjectsFlowGroup, ZeropsProjectsFlowProps } from "./ZeropsProjectsFlow";

function AddVerbs<T>({
  entry,
  onCreateEnvironment,
  offered,
  creating,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly onCreateEnvironment:
    | ((groupId: string, role: ZeropsEnvironmentRole) => void)
    | undefined;
  readonly offered: boolean;
  readonly creating: boolean;
}) {
  if (onCreateEnvironment === undefined || !offered) return null;
  const { groupId } = entry.group;
  return (
    <div className="-ms-1.5 flex flex-wrap items-center gap-1" data-zerops-surface="add-roles">
      <button
        className={QUIET_BUTTON_CLASS}
        disabled={creating}
        onClick={() => onCreateEnvironment(groupId, "dev")}
        type="button"
      >
        <span aria-hidden="true">+</span>
        <span>Add Mate</span>
      </button>
      {/* Optional and never a gate before production (D16, D28): offered
          here only while the project has none, and always from its menu. */}
      {entry.flow.stages.length === 0 ? (
        <button
          className={QUIET_BUTTON_CLASS}
          disabled={creating}
          onClick={() => onCreateEnvironment(groupId, "stage")}
          type="button"
        >
          <span aria-hidden="true">+</span>
          <span>Add stage</span>
          <span className="text-muted-foreground/70">(optional)</span>
        </button>
      ) : null}
    </div>
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
  const target = flow.nextStep.target;
  const mergesHere = (pull: FlowPullRequest) =>
    flow.nextStep.kind === "merge" &&
    target?.kind === "change" &&
    target.repository === pull.repository &&
    target.number === pull.number;
  const groupRows = props.renderGroupRows(group);
  const verb = props.renderNextStep(entry);
  const offered = props.addsOffered?.(group) ?? true;
  const arrow = (
    <span
      aria-hidden="true"
      className="hidden self-center pt-5 text-center text-muted-foreground/60 md:block"
    >
      →
    </span>
  );
  return (
    <section
      className="flex scroll-mt-4 flex-col gap-3 rounded-[var(--zerops-card-radius)] border border-border/60 bg-card p-4"
      data-zerops-group={group.groupId}
      id={`project-${group.groupId}`}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="min-w-0">
          <GroupName className="block text-base" entry={entry} />
        </h2>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {[groupMetaLine(flow), entry.line].filter((part) => part !== undefined).join(" · ")}
        </span>
        {flow.nextStep.kind === "none" ? null : (
          <StatusDot
            className="min-w-0 text-xs"
            label={`Next: ${flow.nextStep.text}`}
            sentence
            tone={nextStepTone(flow.nextStep.kind)}
          />
        )}
        {verb}
        {props.renderGroupMenu(group)}
      </header>
      <div className="flex flex-col gap-3 md:grid md:grid-cols-[minmax(0,1.4fr)_1.25rem_minmax(0,1fr)_1.25rem_minmax(0,1fr)_1.25rem_minmax(0,1.1fr)] md:items-stretch md:gap-0">
        <div className="flex min-w-0 flex-col gap-2" data-zerops-step="mates">
          <MicroLabel className="text-muted-foreground">Mates</MicroLabel>
          {entry.mates.map((item, index) => {
            const preview = flow.mates[index]?.preview;
            return (
              <div className="flex min-w-0 flex-col gap-1" key={props.getKey(item)}>
                {props.renderMate(item)}
                {preview === undefined ? null : <PreviewLink url={preview} />}
              </div>
            );
          })}
          {entry.others.length > 0 ? (
            <ul className="flex flex-col divide-y divide-border/50">
              {entry.others.map(({ item, role }) => (
                <Fragment key={props.getKey(item)}>{props.renderEnvironment(item, role)}</Fragment>
              ))}
            </ul>
          ) : null}
          {entry.mates.length === 0 && entry.others.length === 0 ? (
            <div className={cn(STEP_BOX_CLASS, EMPTY_STEP_CLASS)}>No Mate yet</div>
          ) : null}
        </div>
        {arrow}
        <div className="flex min-w-0 flex-col gap-2" data-zerops-step="pull-requests">
          <MicroLabel className="text-muted-foreground">Pull requests</MicroLabel>
          {flow.pullRequests.length === 0 ? (
            <div className={cn(STEP_BOX_CLASS, EMPTY_STEP_CLASS, "flex-1 justify-center")}>
              {pullRequestsLine(flow)}
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-border/50">
              {flow.pullRequests.map(({ pull }) => (
                <Fragment key={`${pull.repository}#${String(pull.number)}`}>
                  {props.renderPullRequest(group, pull, {
                    withMerge: !mergesHere(pull),
                    compact: true,
                  })}
                </Fragment>
              ))}
            </ul>
          )}
        </div>
        {arrow}
        <div className="flex min-w-0 flex-col gap-2">
          <MicroLabel className="text-muted-foreground">main</MicroLabel>
          <MainStep
            compact={false}
            entry={entry}
            renderStopMenu={props.renderStopMenu}
            verb={null}
          />
        </div>
        {arrow}
        <div className="flex min-w-0 flex-col gap-2">
          <MicroLabel className="text-muted-foreground">Production</MicroLabel>
          <ProductionStep
            compact={false}
            entry={entry}
            renderReleaseVerb={props.renderReleaseVerb}
            renderStopMenu={props.renderStopMenu}
            verb={null}
          />
        </div>
      </div>
      {drawn(groupRows) ? (
        <ul
          className="flex flex-col divide-y divide-border/50"
          data-zerops-surface="environment-rows"
        >
          {groupRows}
        </ul>
      ) : null}
      <AddVerbs
        creating={props.creating ?? false}
        entry={entry}
        offered={offered}
        onCreateEnvironment={props.onCreateEnvironment}
      />
    </section>
  );
}
