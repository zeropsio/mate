import { Link } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  CornerDownRightIcon,
  GitBranchIcon,
  GitMergeIcon,
  GlobeIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { useNowMs } from "~/zerops/useNowMs";
import { useHqAppDetail } from "~/zerops/useHqAppDetail";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";
import { GroupName } from "./flowSteps";
import { lifecycleMain } from "./lifecycle.logic";
import {
  cardReady,
  placeLabel,
  placeLines,
  readyLine,
  readyTitle,
  type PlaceLine,
} from "./projectCard.logic";
import type { ProjectsFlowGroup, ZeropsProjectsFlowProps } from "./ZeropsProjectsFlow";

function Phase({ children, next }: { readonly children: ReactNode; readonly next?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 text-caption text-muted-foreground">
      <h2 className="font-medium">{children}</h2>
      {next ? (
        <span className="hidden xl:flex">
          <ArrowRightIcon aria-hidden="true" className="size-4" />
        </span>
      ) : null}
    </div>
  );
}

/** Composes the overview's observed facts and action slots into the path code takes. */
export function ProjectLifecycle<T>({
  entry,
  props,
  mates,
  renderPlace,
  renderSetUp,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly props: ZeropsProjectsFlowProps<T>;
  readonly mates: ReactNode;
  readonly renderPlace: (line: PlaceLine) => ReactNode;
  readonly renderSetUp: (line: PlaceLine, action: (() => void) | "busy") => ReactNode;
}) {
  const nowMs = useNowMs();
  const { flow, group } = entry;
  const detail = useHqAppDetail(group.groupId);
  const facts = props.cardPlaces?.(entry);
  const places = placeLines({ flow, ...facts, nowMs });
  const stages = places.filter((line) => line.kind === "stage");
  const production = places.find((line) => line.kind === "production");
  const stageCreation = props.stageSettingUp?.(entry);
  const main = lifecycleMain({
    main: flow.main,
    awaiting: entry.awaiting || entry.changesAwaiting || detail.changes === undefined,
    unknown: entry.changesUnknown ?? (detail.failure === null ? undefined : "failed"),
  });
  const ready = cardReady(flow);
  const readyWhere = ready === undefined ? undefined : readyLine(ready, facts?.releaseOnStage);
  const release = ready === undefined ? null : props.renderReleaseVerb?.(entry);
  const productionSetup =
    flow.production.kind === "absent" ? props.setUpProduction?.(entry) : undefined;
  const stageSetup = props.setUpStage?.(entry);
  const creatingStage = flow.creatingStages.length > 0 || stageCreation !== undefined;
  const next = flow.nextStep;
  const notice = entry.line ?? (next.kind === "none" ? undefined : next.text);
  return (
    <section
      aria-label={`${group.name} lifecycle`}
      className="flex min-w-0 flex-col gap-5"
      data-zerops-surface="project-lifecycle"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-title font-medium">
            <GroupName entry={entry} />
          </h1>
          <p className="text-body text-muted-foreground">
            From each Mate's work to the code people use.
          </p>
        </div>
        {props.renderGroupMenu(entry)}
      </header>
      {notice === undefined ? null : (
        <Card variant="inset" size="md">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              tone={
                next.kind === "fix-deploy" || next.kind === "fix-mate" || next.kind === "unblock"
                  ? "warning"
                  : "info"
              }
            >
              {entry.line !== undefined
                ? "Project status"
                : next.kind === "release" || next.kind === "merge"
                  ? "Your decision"
                  : "Next step"}
            </Badge>
            <p className="text-body">{notice}</p>
          </div>
        </Card>
      )}
      <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-3">
          <Phase next>Build</Phase>
          <Card variant="flat">{mates}</Card>
          <p className="text-caption text-muted-foreground">
            Each Mate has its own code and preview. Its preview is separate from shared Stage.
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <Phase next>Shared code</Phase>
          <Card variant="flat" size="md">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-emphasis font-medium">
                <GitMergeIcon aria-hidden="true" className="size-4" />
                main
              </h3>
              {main.state === "merged" ? <Badge tone="success">Merged</Badge> : null}
            </div>
            {main.state === "merged" ? null : (
              <p className="text-body font-medium" role="status">
                {main.heading}
              </p>
            )}
            <p className="text-caption text-muted-foreground">{main.detail}</p>
            {main.state === "merged" && entry.lastMerged !== undefined ? (
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-caption text-muted-foreground">Latest merged change</span>
                <Link
                  className="text-body text-primary hover:underline"
                  to="/change/$groupId/$repository/$number"
                  params={{
                    groupId: group.groupId,
                    repository: entry.lastMerged.repository,
                    number: String(entry.lastMerged.number),
                  }}
                >
                  {entry.lastMerged.title}
                </Link>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                render={<Link to="/git" search={{ appId: group.groupId }} />}
              >
                <GitBranchIcon aria-hidden="true" />
                Browse repositories
              </Button>
            </div>
          </Card>
          <p className="flex items-center gap-2 text-caption text-muted-foreground">
            <CornerDownRightIcon aria-hidden="true" className="size-4 shrink-0" />
            Stage follows its configured source
          </p>
          {stages.map((line) => {
            const observed = flow.stages.find((stop) => stop.projectId === line.projectId)?.version;
            return (
              <Card key={line.projectId ?? line.name} variant="flat">
                <div className="p-4">
                  {renderPlace(line)}
                  {line.git === undefined && observed?.label !== undefined ? (
                    <p className="pt-3 text-caption text-muted-foreground">
                      Last observed version:{" "}
                      {observed.branch === undefined ? null : `${observed.branch} · `}
                      {observed.label}
                    </p>
                  ) : null}
                  {line.projectId === undefined || line.git !== undefined ? null : (
                    <div className="pt-3">
                      <Button
                        variant="secondary"
                        size="sm"
                        render={
                          <Link
                            to="/group/$groupId/$projectId"
                            params={{ groupId: group.groupId, projectId: line.projectId }}
                          />
                        }
                      >
                        Open {placeLabel(line)}
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
          {stages.length === 0 ? (
            <Card variant="flat" size="md">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-emphasis font-medium">Stage</h3>
                <Badge>{creatingStage ? "Setting up" : "Optional"}</Badge>
              </div>
              <p className="text-body text-muted-foreground">
                {creatingStage
                  ? (stageCreation?.step ?? "Stage is being set up.")
                  : "A shared place to verify merged work before you choose a release."}
              </p>
              {!creatingStage && stageSetup !== undefined ? (
                <div className="flex">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={stageSetup === "busy"}
                    onClick={stageSetup === "busy" ? undefined : stageSetup}
                  >
                    Add stage
                  </Button>
                </div>
              ) : null}
            </Card>
          ) : null}
          <p className="text-caption text-muted-foreground">
            Stage is optional. Releases select main independently of what Stage currently runs.
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <Phase>Production</Phase>
          <Card variant="flat" size="md">
            <h3 className="text-emphasis font-medium">
              {flow.production.kind === "releasing" ? "Release in progress" : "Release"}
            </h3>
            <p className="text-body">
              {ready === undefined
                ? "A release fixes the selection of merged code for production."
                : readyTitle(ready)}
            </p>
            {readyWhere === undefined ? null : (
              <p className="text-caption text-muted-foreground">{readyWhere}</p>
            )}
            {release === null ? null : <div className="flex flex-wrap gap-2">{release}</div>}
          </Card>
          <p className="flex items-center gap-2 text-caption text-muted-foreground">
            <CornerDownRightIcon aria-hidden="true" className="size-4 shrink-0" />
            Selected code goes to production
          </p>
          {production === undefined ? null : (
            <Card variant="flat">
              <div className="p-4">
                {productionSetup === undefined
                  ? renderPlace(production)
                  : renderSetUp(production, productionSetup)}
                {props.renderProductionRun?.(entry)}
                {production.projectId === undefined || production.git !== undefined ? null : (
                  <div className="pt-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      render={
                        <Link
                          to="/group/$groupId/$projectId"
                          params={{ groupId: group.groupId, projectId: production.projectId }}
                        />
                      }
                    >
                      Open Production
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          )}
          <p className="flex items-start gap-2 text-caption text-muted-foreground">
            <GlobeIcon aria-hidden="true" className="size-4 shrink-0" />
            Addresses belong to each environment. A custom domain is optional; DNS and certificates
            have their own state.
          </p>
          <Card variant="inset" size="md">
            <h3 className="text-body font-medium">Code, data &amp; recovery</h3>
            <p className="text-caption text-muted-foreground">
              Releases and rollbacks select code. They do not copy or restore runtime data or vault
              values between environments.
            </p>
          </Card>
        </div>
      </div>
      {detail.changes === undefined ? (
        <Card variant="flat" size="md">
          <p className="text-body text-muted-foreground" role="status">
            {main.state === "unknown" ? "Changes cannot be verified." : "Reading changes…"}
          </p>
        </Card>
      ) : props.renderChanges === undefined ? null : (
        <Card variant="flat">{props.renderChanges(entry)}</Card>
      )}
      <details>
        <summary className="cursor-pointer text-body text-muted-foreground">
          Release history
        </summary>
        <div className="pt-3">{props.renderHistory?.(entry)}</div>
      </details>
    </section>
  );
}
