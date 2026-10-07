/**
 * A change's address in a conversation, drawn as the change it names.
 *
 * A Mate writes its change's address at HQ into its message, and that message
 * is frozen the moment it is written: "two pull requests wait for review" goes on
 * saying so an hour after both landed, and the reader has only the bare url to
 * go on (the owner, 2026-09-20: "when I read this and nothing else while its
 * merged its hella confusing").
 *
 * So the url is replaced by the change, with the word that is true now. The
 * sentence around it still says what the Mate said — it is a record of what it
 * knew — and the change beside it says where things actually stand.
 *
 * It renders its children unchanged for every address it cannot claim: another
 * HQ, an organization whose official HQ is not known yet, a session with no flow. A chip is only ever an improvement on a
 * link it is certain about.
 *
 * A change at the official HQ is drawn from its address at once — its
 * application, repository and number are in it — and takes its word from the
 * flow, or from HQ for one the flow does not carry (`useLinkedChange`).
 */
import { changeState, type FlowPullRequest } from "@t3tools/client-runtime/zerops";
import { parseChangeUrl } from "@t3tools/shared/hqChanges";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";
import { GitMergeIcon, GitPullRequestArrow, GitPullRequestClosed } from "lucide-react";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { AppLinkContext } from "../ServiceBrowserLink";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useAppsChanges, useHqAddress } from "../../zerops/projectFlows";
import { useLinkedChange } from "../../zerops/useLinkedChange";

/**
 * When the message a chip stands in was written: a change that landed after
 * it wears a dot, so the sentence's "waiting for review" and the chip's
 * landed glyph read as history, not a contradiction.
 */
export const ChangeChipMomentContext = createContext<string | null>(null);

/** A change closed without merging, as its review says it. */
const CLOSED_WITHOUT_MERGING = "Closed without merging";

const TONE_GLYPH: Record<ServiceStatusToneId, string> = {
  ok: "text-status-ok",
  busy: "text-status-busy",
  attention: "text-status-attention",
  failed: "text-status-failed",
  off: "text-muted-foreground",
};

export function ZeropsChangeLinkChip({
  href,
  words,
  children,
}: {
  readonly href: string | undefined;
  /**
   * The link's own words — a Mate's "[site pull request](…)" — which the chip
   * keeps in place of the change's line: the sentence was written around them.
   */
  readonly words?: ReactNode;
  readonly children: ReactNode;
}) {
  const openInApp = useContext(AppLinkContext);
  const writtenAt = useContext(ChangeChipMomentContext);
  const hqAddress = useHqAddress();
  const link =
    href === undefined || hqAddress === undefined ? null : parseChangeUrl(href, hqAddress);

  // The application's open changes and its newest landed ones, held while the chip is drawn.
  const appId = link?.appId;
  const { changes } = useAppsChanges(useMemo(() => (appId === undefined ? [] : [appId]), [appId]));
  const flow = appId === undefined ? undefined : changes.get(appId);
  const named = (entry: FlowPullRequest) =>
    entry.repository === link?.repo && entry.number === link.number;
  const held = flow?.pullRequests.find(named) ?? flow?.merged.find(named);
  // Only a change the flow does not carry is asked for.
  const landed = useLinkedChange(link === null || held !== undefined ? null : link);
  const pull = held ?? (landed.kind === "read" ? landed.pull : undefined);
  const follow = href === undefined ? null : (openInApp?.(href) ?? null);
  // Drawn from the url while HQ is still answering: the repository and the
  // number are in the address, so the chip does not have to arrive as a
  // full-width url that turns into a chip a moment later. Only the word waits.
  // Missing, refused and unavailable are answers, shown beside the original link.
  const reading =
    pull === undefined && link !== null && (landed.kind === "idle" || landed.kind === "reading");
  if (pull === undefined && !reading) {
    if (landed.kind === "gone" || landed.kind === "refused" || landed.kind === "unavailable") {
      return (
        <span className="inline-flex flex-wrap items-baseline gap-1">
          {children}
          {landed.kind === "gone" ? (
            <span className="text-sm text-muted-foreground">
              {`${link?.repo ?? ""} has no change #${String(link?.number ?? 0)}`}
            </span>
          ) : (
            <Tooltip>
              <TooltipTrigger render={<span className="text-sm text-muted-foreground" />}>
                This change could not be read
              </TooltipTrigger>
              <TooltipPopup>{landed.reason}</TooltipPopup>
            </Tooltip>
          )}
          {landed.readAgain === undefined ? null : (
            <Button variant="link" size="xs" onClick={landed.readAgain}>
              Read again
            </Button>
          )}
        </span>
      );
    }
    return children;
  }

  const line = pull?.line ?? `${link?.repo ?? ""} #${String(link?.number ?? 0)}`;
  // The state is a glyph of one size, never a word of its own width: a change
  // landing reflows nothing in the sentence around it. The words are the
  // tooltip's.
  // A change closed without merging is over: what it last conflicted with is no longer true.
  const closed = pull !== undefined && !pull.merged && pull.state === "closed";
  const openState = pull === undefined || pull.merged || closed ? undefined : changeState(pull);
  const state =
    pull === undefined
      ? undefined
      : pull.merged
        ? { word: "Landed", tone: "ok" as const, kind: "landed" as const }
        : closed
          ? { word: CLOSED_WITHOUT_MERGING, tone: "off" as const, kind: "closed" as const }
          : openState === undefined
            ? undefined
            : { word: openState.word, tone: openState.tone, kind: "open" as const };
  const landedSince =
    pull?.merged === true &&
    writtenAt !== null &&
    pull.mergedAt !== undefined &&
    Date.parse(pull.mergedAt) > Date.parse(writtenAt);
  const Glyph =
    state?.kind === "landed"
      ? GitMergeIcon
      : state?.kind === "closed"
        ? GitPullRequestClosed
        : GitPullRequestArrow;
  const chip = (
    <a
      className="inline-flex items-baseline gap-1 rounded-md border border-border bg-muted px-1.5 align-baseline text-sm no-underline"
      data-zerops-change-state={state === undefined ? "reading" : state.kind}
      data-zerops-change-since={landedSince ? "landed" : undefined}
      data-zerops-change-chip={`${pull?.repository ?? link?.repo ?? ""}#${String(pull?.number ?? link?.number ?? 0)}`}
      href={href}
      onClick={(event) => {
        if (
          !follow ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        follow();
      }}
      rel="noopener noreferrer"
      target="_blank"
    >
      <span className="relative inline-flex shrink-0 self-center">
        <Glyph
          aria-hidden="true"
          className={cn(
            "size-3",
            state === undefined ? "text-muted-foreground" : TONE_GLYPH[state.tone],
          )}
        />
        {landedSince ? (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-info ring-1 ring-muted"
          />
        ) : null}
      </span>
      <span className="font-medium">{words ?? line}</span>
      {state === undefined ? null : (
        <span className="sr-only">
          {`, ${state.word}${landedSince ? ", landed since this message" : ""}`}
        </span>
      )}
    </a>
  );
  if (state === undefined) return chip;
  return (
    <Tooltip>
      <TooltipTrigger render={chip} />
      <TooltipPopup side="top">
        {state.word}
        {landedSince ? " — landed after this was written" : ""}
      </TooltipPopup>
    </Tooltip>
  );
}
