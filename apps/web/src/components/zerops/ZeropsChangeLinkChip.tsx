/**
 * A change's address in a conversation, drawn as the change it names.
 *
 * A Mate writes a pull request's url into its message and that message is
 * frozen the moment it is written: "two pull requests wait for review" goes on
 * saying so an hour after both landed, and the reader has only the bare url to
 * go on (the owner, 2026-09-20: "when I read this and nothing else while its
 * merged its hella confusing").
 *
 * So the url is replaced by the change, with the word that is true now. The
 * sentence around it still says what the Mate said — it is a record of what it
 * knew — and the change beside it says where things actually stand.
 *
 * It renders its children unchanged for every address it cannot claim: another
 * forge, a change this account cannot read, a session with no flow. A chip is
 * only ever an improvement on a link it is certain about.
 *
 * A change on this Gitea is drawn from its address at once, even on an org the
 * registry does not name yet — a project made since the page loaded, or a
 * registry read that failed. The chip asks for the org, and takes its word and
 * its in-app open once the registry names it.
 */
import { changeState, parseGiteaChangeUrl } from "@t3tools/client-runtime/zerops";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";
import { GitMergeIcon, GitPullRequestArrow } from "lucide-react";
import { createContext, useContext, useEffect, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { AppLinkContext } from "../ServiceBrowserLink";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useZeropsProjectFlowOptional } from "../../zerops/projectFlowContext";
import { useZeropsLandedChange } from "../../zerops/useZeropsLandedChange";

/**
 * When the message a chip stands in was written: a change that landed after
 * it wears a dot, so the sentence's "waiting for review" and the chip's
 * landed glyph read as history, not a contradiction.
 */
export const ChangeChipMomentContext = createContext<string | null>(null);

const TONE_GLYPH: Record<ServiceStatusToneId, string> = {
  ok: "text-status-ok",
  busy: "text-status-busy",
  attention: "text-status-attention",
  failed: "text-status-failed",
  off: "text-muted-foreground",
};

export function ZeropsChangeLinkChip({
  href,
  children,
}: {
  readonly href: string | undefined;
  readonly children: ReactNode;
}) {
  const flowValue = useZeropsProjectFlowOptional();
  const openInApp = useContext(AppLinkContext);
  const writtenAt = useContext(ChangeChipMomentContext);
  const link = href === undefined ? null : parseGiteaChangeUrl(href, flowValue?.giteaOrigin);

  let groupId: string | undefined;
  if (link !== null && flowValue !== null) {
    for (const [id, slug] of flowValue.slugs) {
      if (slug === link.owner) {
        groupId = id;
        break;
      }
    }
  }
  const unknownOwner =
    link !== null && flowValue !== null && groupId === undefined ? link.owner : undefined;
  const askForOwner = flowValue?.askForOwner;
  useEffect(() => {
    if (unknownOwner !== undefined) askForOwner?.(unknownOwner);
  }, [askForOwner, unknownOwner]);
  const open =
    groupId === undefined
      ? undefined
      : flowValue?.flows
          .get(groupId)
          ?.pullRequests.find(
            (entry) => entry.repository === link?.repository && entry.number === link.number,
          );
  // Only a change the flow does not carry is asked for: the flow holds the open
  // ones, and a landed change is exactly the case that reads as stale.
  const landed = useZeropsLandedChange(
    link === null || groupId === undefined || open !== undefined
      ? null
      : {
          giteaOrigin: flowValue?.giteaOrigin,
          owner: link.owner,
          repository: link.repository,
          number: link.number,
        },
  );
  const pull = open ?? (landed.kind === "read" ? landed.pull : undefined);
  const follow = href === undefined ? null : (openInApp?.(href) ?? null);
  // Drawn from the url while the registry or the forge is still answering: the
  // repository and the number are in the address, so the chip does not have to
  // arrive as a full-width url that turns into a chip a moment later. Only the
  // word waits. `gone` and `failed` are answers, not waits: a change this
  // account cannot read stays the link it was.
  const reading =
    pull === undefined &&
    link !== null &&
    flowValue !== null &&
    (groupId === undefined || landed.kind === "idle" || landed.kind === "reading");
  if (pull === undefined && !reading) return children;

  const line = pull?.line ?? `${link?.repository ?? ""} #${String(link?.number ?? 0)}`;
  // The state is a glyph of one size, never a word of its own width: a change
  // landing reflows nothing in the sentence around it. The words are the
  // tooltip's.
  const openState = pull === undefined || pull.merged ? undefined : changeState(pull);
  const state =
    pull === undefined
      ? undefined
      : pull.merged
        ? { word: "Landed", tone: "ok" as const, merged: true }
        : openState === undefined
          ? undefined
          : { word: openState.word, tone: openState.tone, merged: false };
  const landedSince =
    pull?.merged === true &&
    writtenAt !== null &&
    pull.mergedAt !== undefined &&
    Date.parse(pull.mergedAt) > Date.parse(writtenAt);
  const Glyph = state?.merged ? GitMergeIcon : GitPullRequestArrow;
  const chip = (
    <a
      className="inline-flex items-baseline gap-1 rounded-md border border-border bg-muted px-1.5 align-baseline text-sm no-underline"
      data-zerops-change-state={state === undefined ? "reading" : state.merged ? "landed" : "open"}
      data-zerops-change-since={landedSince ? "landed" : undefined}
      data-zerops-change-chip={`${pull?.repository ?? link?.repository ?? ""}#${String(pull?.number ?? link?.number ?? 0)}`}
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
      <span className="font-medium">{line}</span>
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
