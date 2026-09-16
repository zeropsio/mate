/**
 * The Git tab — the fourth right-panel surface, beside Diff, Browser and Data.
 *
 * Two halves, in the order a person reads them (guide 4.5). **This Mate's code
 * repositories** first: one block each, the branch the container is on and
 * where that branch goes. Then **the group**: every stage and the production
 * with what it follows and what it runs, the releases, and the pull requests
 * open on the group repo — the per-group view of 4.4, placed where the person
 * already is.
 *
 * Every fact comes from the party that can prove it, and each one arrives on
 * its own schedule: the checkout is a live subscription, and the Gitea side is
 * re-read when the tab opens, after each action, and every sixty seconds while
 * it is open. Nothing here decides anything — `gitTab.ts`, `groupRows.ts` and
 * `release.ts` do, and this renders what they produced (R5).
 *
 * Signed out of Gitea, the first half still works: the container is the Mate
 * server's to stream and needs no forge. The rest says so in one line and
 * offers the way in, rather than showing empty sections that look like a group
 * with nothing in it.
 */
import type {
  EnvironmentRow,
  GitBlock,
  ReleaseComparison,
  ReleaseGate,
  ReleaseVerdict,
} from "@t3tools/client-runtime/zerops";
import { deployWord, releaseWord } from "@t3tools/client-runtime/zerops";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";
import type { ReactNode } from "react";

import { ScrollArea } from "~/components/ui/scroll-area";
import { cn } from "~/lib/utils";
import { deployRowTone } from "./ZeropsProjectRow.logic";
import { ZeropsGitBlock } from "./ZeropsGitBlock";
import { ZeropsMateVerb } from "./ZeropsMateCard";
import { MicroLabel, Pill, StatusDot } from "./primitives";

/** One release of the group, as the tab shows it. */
export interface ZeropsGitRelease {
  readonly tag: string;
  readonly verdict: ReleaseVerdict;
  /** Why the broker refused it, when it did. */
  readonly detail: string | undefined;
  /** `api 3f9c1b2 · web 77ab0e1` — what the tag lists, short. */
  readonly line: string;
}

/** A recipe change waiting on somebody. */
export interface ZeropsGitRecipeChange {
  readonly number: number;
  readonly title: string;
  readonly line: string;
  readonly url: string | undefined;
}

/** What *Release* offers, when it is offered at all. */
export interface ZeropsGitReleaseOffer {
  readonly gate: ReleaseGate;
  /** The next patch, suggested from the newest existing tag. */
  readonly suggestion: string;
  readonly comparison: ReadonlyArray<ReleaseComparison>;
}

export interface ZeropsGitPanelModel {
  /** Whether this tab holds a Gitea session; without one only the checkout half can speak. */
  readonly signedIn: boolean;
  readonly blocks: ReadonlyArray<GitBlock>;
  readonly environments: ReadonlyArray<EnvironmentRow>;
  readonly releases: ReadonlyArray<ZeropsGitRelease>;
  readonly recipeChanges: ReadonlyArray<ZeropsGitRecipeChange>;
  readonly release: ZeropsGitReleaseOffer | undefined;
}

const RELEASE_VERDICT_TONE: Record<ReleaseVerdict, ServiceStatusToneId | undefined> = {
  approved: "ok",
  refused: "failed",
  pending: "busy",
  unknown: undefined,
};

function Section({
  label,
  children,
  hint,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly hint?: string;
}) {
  return (
    <section className="flex flex-col gap-1" data-zerops-git-section={label}>
      <MicroLabel>{label}</MicroLabel>
      {hint === undefined ? null : <span className="text-xs text-muted-foreground">{hint}</span>}
      {children}
    </section>
  );
}

function Row({
  name,
  tag,
  line,
  status,
  action,
}: {
  readonly name: string;
  readonly tag?: string;
  readonly line: string;
  readonly status?: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <li
      className="grid min-h-9 grid-cols-[minmax(0,5fr)_minmax(0,4fr)_auto] items-center gap-x-3"
      data-zerops-git-row={name}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate text-[13px] text-foreground">{name}</span>
        {tag === undefined ? null : <MicroLabel>{tag}</MicroLabel>}
      </span>
      <span className="min-w-0 truncate text-xs text-muted-foreground">{line}</span>
      <span className="flex shrink-0 items-center justify-end gap-3">
        {status}
        {action}
      </span>
    </li>
  );
}

export interface ZeropsGitPanelProps {
  readonly model: ZeropsGitPanelModel;
  /** The verb under a repository's block — already gated (`gitActionAllowed`). */
  readonly renderBlockAction?: (block: GitBlock) => ReactNode;
  readonly onOpenPullRequest?: (block: GitBlock) => void;
  readonly onOpenRecipeChange?: (change: ZeropsGitRecipeChange) => void;
  /** Starts a release; absent hides the button whatever the gate says. */
  readonly onRelease?: (() => void) | undefined;
  /** Makes a new tag listing an earlier release's commits (5.6). */
  readonly onRollBack?: ((release: ZeropsGitRelease) => void) | undefined;
  /** Sends the person through Gitea's sign-in, which is what the rest needs. */
  readonly onSignIn?: (() => void) | undefined;
  readonly className?: string;
}

export function ZeropsGitPanel({
  model,
  renderBlockAction,
  onOpenPullRequest,
  onOpenRecipeChange,
  onRelease,
  onRollBack,
  onSignIn,
  className,
}: ZeropsGitPanelProps) {
  const offer = model.release;
  return (
    <ScrollArea className={cn("min-h-0 flex-1", className)}>
      <div className="flex flex-col gap-6 px-4 py-4" data-zerops-surface="git-panel">
        <Section label="Repositories">
          {model.blocks.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              This Mate has no code repository yet.
            </span>
          ) : (
            <ul className="flex flex-col divide-y divide-border/50">
              {model.blocks.map((block) => (
                <ZeropsGitBlock
                  action={renderBlockAction?.(block)}
                  block={block}
                  key={block.repository}
                  onOpenPullRequest={
                    block.pullRequestNumber === undefined || onOpenPullRequest === undefined
                      ? undefined
                      : () => onOpenPullRequest(block)
                  }
                />
              ))}
            </ul>
          )}
        </Section>

        {model.signedIn ? null : (
          <Section
            hint="Sign in to Gitea to see this project's environments, its releases and its pull requests."
            label="The project"
          >
            {onSignIn === undefined ? null : (
              <div className="flex">
                <Pill label="Sign in to Gitea" onClick={onSignIn} />
              </div>
            )}
          </Section>
        )}

        {model.signedIn && model.environments.length > 0 ? (
          <Section label="Environments">
            <ul className="flex flex-col divide-y divide-border/50">
              {model.environments.map((environment) => {
                const tone = deployRowTone(environment.tone);
                const word = deployWord(environment.tone);
                return (
                  <Row
                    action={
                      environment.tier === "production" &&
                      onRelease !== undefined &&
                      offer !== undefined &&
                      offer.gate.allowed ? (
                        // A verb and not a CTA pill: every row in this column
                        // is the same height, and a button that made one row
                        // taller than its neighbours is the layout shift this
                        // panel refuses.
                        <ZeropsMateVerb label="Release" onClick={onRelease} />
                      ) : undefined
                    }
                    key={environment.projectId}
                    line={environment.line}
                    name={environment.name}
                    status={
                      tone === undefined || word === undefined ? undefined : (
                        <StatusDot label={word} tone={tone} />
                      )
                    }
                    tag={environment.tier === "production" ? "prod" : "stage"}
                  />
                );
              })}
            </ul>
            {offer !== undefined && !offer.gate.allowed ? (
              <span className="text-xs text-muted-foreground" data-zerops-surface="release-gate">
                {offer.gate.reason}
              </span>
            ) : null}
          </Section>
        ) : null}

        {model.signedIn && model.releases.length > 0 ? (
          <Section label="Releases">
            <ul className="flex flex-col divide-y divide-border/50">
              {model.releases.map((release, index) => {
                const tone = RELEASE_VERDICT_TONE[release.verdict];
                const word = releaseWord(release.verdict);
                return (
                  <Row
                    action={
                      // The newest release is what production already runs, so
                      // rolling back to it would be a tag that changes nothing;
                      // a release the broker refused was never deployed, so
                      // there is nothing to go back to.
                      index === 0 ||
                      release.verdict !== "approved" ||
                      onRollBack === undefined ? undefined : (
                        <ZeropsMateVerb
                          label="Roll back to this"
                          onClick={() => onRollBack(release)}
                        />
                      )
                    }
                    key={release.tag}
                    line={release.detail ?? release.line}
                    name={release.tag}
                    status={
                      tone === undefined || word === undefined ? undefined : (
                        <StatusDot label={word} tone={tone} />
                      )
                    }
                  />
                );
              })}
            </ul>
          </Section>
        ) : null}

        {model.signedIn && model.recipeChanges.length > 0 ? (
          <Section label="Recipe changes">
            <ul className="flex flex-col divide-y divide-border/50">
              {model.recipeChanges.map((change) => (
                <Row
                  action={
                    change.url === undefined || onOpenRecipeChange === undefined ? undefined : (
                      <button
                        className="rounded-sm text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => onOpenRecipeChange(change)}
                        type="button"
                      >
                        Review
                      </button>
                    )
                  }
                  key={change.number}
                  line={change.line}
                  name={change.title}
                />
              ))}
            </ul>
          </Section>
        ) : null}
      </div>
    </ScrollArea>
  );
}
