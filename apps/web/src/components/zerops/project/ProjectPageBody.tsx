/**
 * A project's own page: a header, a main column for what changes day to day — what waits on the
 * person, its places, its Mates, its changes — and a side column for what is set up once. It reads
 * the group the overview's flow reads and draws through the same slots its cards fill, so a Mate's
 * row and a change say the same on both; nothing on it is said twice.
 */
import { Fragment, useMemo, type ReactNode } from "react";
import { PlusIcon } from "lucide-react";

import { ComingMateFace, GroupName, matesOf, type FlowMateEntry } from "../projects/flowSteps";
import { mateChangeForReview } from "../projects/projectCard.logic";
import { comingMateLine } from "../projects/projectsView.logic";
import { ProjectPageSpend, ProjectSpendSection } from "../projects/ProjectSpend";
import { ProjectPageHistory } from "../projects/ProjectHistory";
import { spendProjectIds } from "../projects/projectSpend.logic";
import type { ProjectsFlowGroup, ZeropsProjectsFlowProps } from "../projects/ZeropsProjectsFlow";

export function ProjectPageBody<T>({
  entry,
  props,
  addMateWhy,
  onAddMate,
  side,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly props: ZeropsProjectsFlowProps<T>;
  /** Why the project takes no Mate now, known before the press. */
  readonly addMateWhy: string | null;
  readonly onAddMate: () => void;
  /** The side column: what is set up once. */
  readonly side: ReactNode;
}) {
  const { group, flow } = entry;
  const spendIds = useMemo(() => spendProjectIds(flow), [flow]);
  return (
    <div className="pp" data-zerops-surface="project-page">
      <header className="pp-head">
        <h1 className="pp-title">
          <GroupName entry={entry} />
        </h1>
        <span className="pp-head-acts">{props.renderGroupMenu(entry)}</span>
      </header>
      <div className="pp-cols">
        <div className="pp-main">
          <ProjectMates addMateWhy={addMateWhy} entry={entry} onAdd={onAddMate} props={props} />
          {props.renderChanges?.(entry)}
        </div>
        <ProjectPageSpend
          value={<ProjectSpendSection appId={group.groupId} projectIds={spendIds} />}
        >
          <ProjectPageHistory value={props.renderHistory?.(entry) ?? null}>
            <div className="pp-side">{side}</div>
          </ProjectPageHistory>
        </ProjectPageSpend>
      </div>
    </div>
  );
}

/** Every Mate of the project, as the menu says each, and *Add a Mate* at their foot. */
function ProjectMates<T>({
  entry,
  props,
  onAdd,
  addMateWhy,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly props: ZeropsProjectsFlowProps<T>;
  readonly onAdd: () => void;
  readonly addMateWhy: string | null;
}) {
  const draw = (mate: FlowMateEntry<T>) =>
    mate.kind === "coming" ? (
      <ComingMate
        birth={props.renderComingBirth?.(mate.mate.projectId)}
        key={`coming:${mate.mate.projectId}`}
        mate={mate}
      />
    ) : (
      <Fragment key={props.getKey(mate.item)}>
        {props.renderMate(mate.item, {
          layout: "row",
          parts: mate.mate.parts ?? [],
          // A change is offered for review only once the project's changes are read and known.
          review:
            entry.changesAwaiting || entry.changesUnknown !== undefined
              ? undefined
              : mateChangeForReview(entry.flow, mate.mate.projectId),
        })}
      </Fragment>
    );
  return (
    <section aria-label="Mates" className="ov-sec ov-mates" data-zerops-step="mates">
      <h2 className="ov-sec-name">Mates</h2>
      {matesOf(entry).map(draw)}
      {addMateWhy === null ? (
        <button className="ov-add" data-zerops-surface="add-mate" onClick={onAdd} type="button">
          <span aria-hidden="true" className="ov-add-face">
            <PlusIcon className="size-4" />
          </span>
          <span>Add a Mate</span>
        </button>
      ) : (
        <button
          aria-describedby={`${entry.group.groupId}-add-why`}
          className="ov-add"
          data-zerops-surface="add-mate"
          disabled
          type="button"
        >
          <span aria-hidden="true" className="ov-add-face">
            <PlusIcon className="size-4" />
          </span>
          <span className="ov-add-words">
            <span>Add a Mate</span>
            <span className="ov-add-why" data-part="why" id={`${entry.group.groupId}-add-why`}>
              {addMateWhy}
            </span>
          </span>
        </button>
      )}
    </section>
  );
}

/** A Mate being created: waking, named, how far its birth has got, nothing to press. */
function ComingMate<T>({
  mate,
  birth,
}: {
  readonly mate: Extract<FlowMateEntry<T>, { kind: "coming" }>;
  readonly birth: { readonly line: string; readonly menu: ReactNode } | undefined;
}) {
  return (
    <div aria-busy="true" className="ov-mate" data-zerops-surface="mate-coming" role="listitem">
      <span className="ov-mate-face">
        <ComingMateFace coming={mate.coming} size={24} />
      </span>
      <span className="ov-mate-text">
        <span className="ov-mate-l1">
          <span className="ov-mate-name">{mate.mate.name}</span>
        </span>
        <span className="ov-mate-l2">{birth?.line ?? comingMateLine(mate.coming)}</span>
      </span>
      {birth?.menu}
    </div>
  );
}
