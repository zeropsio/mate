/**
 * A project page's Changes: what waits on the person, lifted with its Review; merged work no
 * release took yet; then released work under the release that carried it — the one production
 * runs open, each older release folded to a line that opens production's releases.
 *
 * Drawn from its reads, handed in, so a test and the harness look at it with no account behind it.
 */
import { flowVerbLabel } from "@t3tools/client-runtime/zerops";
import { ArrowUpRightIcon, ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { pullRequestLinkWords, pullRequestName } from "~/zerops/automatedMate.logic";
import { useNowMs } from "~/zerops/useNowMs";

import { compactSidebarTimeLabel } from "../../Sidebar.logic";
import type { CardChange } from "./projectCard.logic";
import type { ProjectChangeGroups, ReleaseGroup } from "./projectChangesCard.logic";
import { CardGroupName, CardRowsHeld, ProjectPageCard } from "./ProjectPageCard";

/** A change's Mate, as the card names it: its name and face, where the page holds it. */
export interface ChangeMate {
  readonly name: string;
  readonly face?: ReactNode;
}

export function ProjectChangesCard({
  groups,
  read,
  mateOf,
  onOpen,
  onOpenRelease,
  onRelease,
  releasing = false,
  emptyAction,
}: {
  readonly groups: ProjectChangeGroups;
  /**
   * `known` once HQ told the project's changes; `reading` until then (rows held at their size);
   * otherwise why they are not told, in HQ's words.
   */
  readonly read:
    | { readonly state: "known" | "reading" }
    | { readonly state: "untold"; readonly words: string };
  readonly mateOf: (projectId: string) => ChangeMate | undefined;
  /** Opens a change's review, from the row pressed. */
  readonly onOpen: (change: CardChange, from: HTMLElement) => void;
  /** Opens production's releases, where it has a page; absent, a folded release is only a line. */
  readonly onOpenRelease?: ((tag: string) => void) | undefined;
  /**
   * Opens the release review, from the button pressed: the ready group's *Release*, the same
   * review as the road's chip. Absent, the group offers none.
   */
  readonly onRelease?: ((from: HTMLElement) => void) | undefined;
  /** A release is on its way: its Release waits, saying so, until it lands. */
  readonly releasing?: boolean | undefined;
  /** The way to a first environment, where the project has no repository yet. */
  readonly emptyAction?:
    | { readonly words: string; readonly label: string; readonly onPress: () => void }
    | undefined;
}) {
  const nowMs = useNowMs();
  const ago = (at: string | undefined) =>
    at === undefined ? "" : compactSidebarTimeLabel(formatRelativeTimeLabel(at, nowMs));
  const { waiting, drafts, ready, releases } = groups;
  const nothing =
    waiting.length === 0 &&
    drafts.length === 0 &&
    ready.changes.length === 0 &&
    releases.length === 0;
  const body =
    read.state === "reading" ? (
      <CardRowsHeld rows={3} />
    ) : read.state === "untold" ? (
      <p className="pp-cards-empty">{read.words}</p>
    ) : nothing ? (
      emptyAction === undefined ? (
        <p className="pp-cards-empty">No changes yet — a Mate opens one as it works.</p>
      ) : (
        <div className="flex min-w-0 items-center justify-between gap-3">
          <p className="pp-cards-empty">{emptyAction.words}</p>
          <Button onClick={emptyAction.onPress} size="sm" variant="secondary">
            {emptyAction.label}
          </Button>
        </div>
      )
    ) : (
      <>
        {waiting.length === 0 ? null : (
          <div className="grid gap-2" data-zerops-changes="waiting">
            <CardGroupName count={waiting.length}>Waiting on you</CardGroupName>
            <ul className="pp-cards-lift">
              {waiting.map((change) => (
                <WaitingRow
                  change={change}
                  key={changeKey(change)}
                  mate={mateOf(change.pull.mateProjectId)}
                  onOpen={onOpen}
                  when={ago(change.at)}
                />
              ))}
            </ul>
          </div>
        )}
        {drafts.length === 0 ? null : (
          <div className="grid gap-1" data-zerops-changes="drafts">
            <CardGroupName count={drafts.length}>Being written</CardGroupName>
            <ul className="grid">
              {drafts.map((change) => (
                <ChangeRow
                  change={change}
                  key={changeKey(change)}
                  mate={mateOf(change.pull.mateProjectId)}
                  onOpen={onOpen}
                  when={ago(change.at)}
                />
              ))}
            </ul>
          </div>
        )}
        {ready.changes.length === 0 ? null : (
          <div className="grid gap-1" data-zerops-changes="ready">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <CardGroupName
                after={ready.onStage ? "on stage" : undefined}
                count={ready.changes.length}
              >
                {ready.title}
              </CardGroupName>
              {onRelease === undefined || ready.title !== "Ready to release" ? null : (
                <Button
                  disabled={releasing}
                  onClick={(event) => {
                    onRelease(event.currentTarget);
                  }}
                  size="sm"
                >
                  {releasing ? flowVerbLabel("release", true) : "Release"}
                </Button>
              )}
            </div>
            <ul className="grid">
              {ready.changes.map((change) => (
                <ChangeRow
                  change={change}
                  key={changeKey(change)}
                  mate={mateOf(change.pull.mateProjectId)}
                  merged
                  onOpen={onOpen}
                  when={ago(change.at)}
                />
              ))}
            </ul>
          </div>
        )}
        {releases.length === 0 ? null : (
          <div className="grid gap-1" data-zerops-changes="released">
            {releases.map((release) =>
              release.open ? (
                <div className="grid gap-1" data-zerops-release={release.tag} key={release.tag}>
                  <ReleaseLine release={release} when={ago(release.taggedAt)} />
                  {release.changes.length === 0 ? null : (
                    <ul className="grid">
                      {release.changes.map((change) => (
                        <ChangeRow
                          change={change}
                          key={changeKey(change)}
                          mate={mateOf(change.pull.mateProjectId)}
                          onOpen={onOpen}
                          when={ago(change.at)}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <ReleaseLine
                  key={release.tag}
                  onOpen={onOpenRelease}
                  release={release}
                  when={ago(release.taggedAt)}
                />
              ),
            )}
          </div>
        )}
      </>
    );
  return (
    <ProjectPageCard busy={read.state === "reading"} surface="project-changes" title="Changes">
      {body}
    </ProjectPageCard>
  );
}

const changeKey = (change: CardChange) => `${change.pull.repository}#${String(change.pull.number)}`;

function Face({ mate }: { readonly mate: ChangeMate | undefined }) {
  return (
    <span aria-hidden="true" className="pp-cards-face">
      {mate?.face ?? null}
    </span>
  );
}

/** A change asking for review: face, title, whose and its state, and its Review. */
function WaitingRow({
  change,
  mate,
  when,
  onOpen,
}: {
  readonly change: CardChange;
  readonly mate: ChangeMate | undefined;
  readonly when: string;
  readonly onOpen: (change: CardChange, from: HTMLElement) => void;
}) {
  const line = [mate?.name, when, change.words].filter((part) => part !== undefined && part !== "");
  return (
    <li className="pp-cards-waiting" data-zerops-change={changeKey(change)}>
      <Face mate={mate} />
      <button
        className="pp-cards-waiting-text"
        onClick={(event) => {
          onOpen(change, event.currentTarget);
        }}
        type="button"
      >
        <span className="truncate text-prose font-medium text-foreground">{change.pull.title}</span>
        <span className="truncate text-caption text-muted-foreground" data-tone={change.tone}>
          {line.join(" · ")}
        </span>
      </button>
      <Button
        onClick={(event) => {
          onOpen(change, event.currentTarget);
        }}
        size="sm"
      >
        Review
      </Button>
    </li>
  );
}

/** A change on one line: face, title, and on the right whose and when. */
function ChangeRow({
  change,
  mate,
  when,
  merged = false,
  onOpen,
}: {
  readonly change: CardChange;
  readonly mate: ChangeMate | undefined;
  readonly when: string;
  /** Says when it merged rather than when it moved. */
  readonly merged?: boolean;
  readonly onOpen: (change: CardChange, from: HTMLElement) => void;
}) {
  const time = when === "" ? undefined : merged ? `merged ${when} ago` : when;
  const end = [mate?.name, time].filter((part) => part !== undefined).join(" · ");
  const github = change.pull.pullRequest;
  return (
    <li className="flex min-w-0 items-center gap-2" data-zerops-change={changeKey(change)}>
      <button
        className="pp-cards-row pp-cards-press min-w-0 flex-1"
        onClick={(event) => {
          onOpen(change, event.currentTarget);
        }}
        type="button"
      >
        <Face mate={mate} />
        <span className="min-w-0 flex-1 truncate text-start text-line text-foreground">
          {change.pull.title}
        </span>
        <span className="shrink-0 text-caption text-muted-foreground tabular-nums">{end}</span>
      </button>
      {/* Its pull request on GitHub, where the change is mirrored to one: the automation's link. */}
      {github === undefined ? null : (
        <a
          aria-label={pullRequestLinkWords(github)}
          className="pp-cards-pr"
          href={github.url}
          rel="noreferrer"
          target="_blank"
        >
          {pullRequestName(github)}
          <ArrowUpRightIcon aria-hidden="true" className="size-3" />
        </a>
      )}
    </li>
  );
}

/** A release's line: its tag, Live where production runs it, when, and — folded — its door. */
function ReleaseLine({
  release,
  when,
  onOpen,
}: {
  readonly release: ReleaseGroup;
  readonly when: string;
  readonly onOpen?: ((tag: string) => void) | undefined;
}) {
  const words = [
    when === "" ? undefined : `released ${when} ago`,
    release.open || release.count === undefined || release.count === 0
      ? undefined
      : release.count === 1
        ? "1 change"
        : `${String(release.count)} changes`,
  ].filter((part) => part !== undefined);
  const content = (
    <>
      <span className="pp-cards-tag">{release.tag}</span>
      {release.live ? <Badge tone="success">Live</Badge> : null}
      <span className="shrink-0 text-caption text-muted-foreground">{words.join(" · ")}</span>
      <span aria-hidden="true" className="pp-cards-rule" />
      {release.open || onOpen === undefined ? null : (
        <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      )}
    </>
  );
  if (release.open || onOpen === undefined)
    return (
      <p className="pp-cards-row" data-zerops-release-line={release.tag}>
        {content}
      </p>
    );
  return (
    <button
      aria-label={`${release.tag}, ${words.join(", ")}`}
      className="pp-cards-row pp-cards-press"
      data-zerops-release-line={release.tag}
      onClick={() => {
        onOpen(release.tag);
      }}
      type="button"
    >
      {content}
    </button>
  );
}
