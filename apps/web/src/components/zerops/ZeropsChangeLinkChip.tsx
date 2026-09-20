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
 */
import { changeState, parseGiteaChangeUrl } from "@t3tools/client-runtime/zerops";
import { GitPullRequestArrow } from "lucide-react";
import { useContext, type ReactNode } from "react";

import { AppLinkContext } from "../ServiceBrowserLink";
import { useZeropsProjectFlowOptional } from "../../zerops/projectFlowContext";
import { useZeropsLandedChange } from "../../zerops/useZeropsLandedChange";

export function ZeropsChangeLinkChip({
  href,
  children,
}: {
  readonly href: string | undefined;
  readonly children: ReactNode;
}) {
  const flowValue = useZeropsProjectFlowOptional();
  const openInApp = useContext(AppLinkContext);
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
  if (pull === undefined) return children;

  const state = pull.merged ? "Landed" : changeState(pull)?.word;
  return (
    <a
      className="inline-flex items-baseline gap-1 rounded-md border border-border bg-muted px-1.5 align-baseline text-sm no-underline"
      data-zerops-change-chip={`${pull.repository}#${String(pull.number)}`}
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
      <GitPullRequestArrow aria-hidden="true" className="size-3 shrink-0 self-center" />
      <span className="font-medium">{pull.line}</span>
      {state === undefined ? null : <span className="text-muted-foreground">{state}</span>}
    </a>
  );
}
