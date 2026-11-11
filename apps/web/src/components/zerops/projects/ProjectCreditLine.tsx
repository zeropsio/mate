/**
 * One line where Zerops will soon stop a project of a card or a project page for insufficient
 * funds: which project, when — in Zerops's own hours — and the way out: a top-up in HQ, or
 * asking an owner. Amber while days away, red within the Zerops GUI's own eight hours. Nothing
 * while all is well, and nothing to a member Zerops shows no finances to.
 */
import { useAtomValue } from "@effect/atom-react";
import { listedProjectAtom, projectsCreditAtom, stopWords } from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import type { JSX } from "react";

import { cn } from "~/lib/utils";
import { useAccountDataOptional } from "~/zerops/accountData";
import { hqCreditUrl } from "~/zerops/hqCredit";
import { useCreditOffers } from "~/zerops/usePlatformCapabilities";

import { InlineButton } from "../../ui/button";

const NO_PROJECT = Atom.make(null);

export function ProjectCreditLine({
  projectIds,
  className,
}: {
  readonly projectIds: ReadonlyArray<string>;
  /** The surface's own line layout (a card's header, a page's column). */
  readonly className?: string;
}): JSX.Element | null {
  const credit = useAtomValue(projectsCreditAtom([...projectIds].sort().join(",")));
  const project = useAtomValue(
    credit.projectId === null ? NO_PROJECT : listedProjectAtom(credit.projectId),
  );
  const { addCredit } = useCreditOffers();
  const orgId = useAccountDataOptional()?.orgId ?? null;
  if (credit.projectId === null || credit.hoursLeft === null) return null;
  return (
    <p
      className={cn(
        "text-sm",
        credit.tone === "out" ? "text-status-failed-text" : "text-status-attention-text",
        className,
      )}
      data-tone={credit.tone}
      data-zerops-surface="project-credit"
    >
      {project?.name ?? "A project"} stops {stopWords(credit.hoursLeft)}: not enough credit.{" "}
      {addCredit && orgId !== null ? (
        <InlineButton render={<a href={hqCreditUrl(orgId)} rel="noreferrer" target="_blank" />}>
          Top up in HQ
        </InlineButton>
      ) : (
        "Ask an owner to top up."
      )}
    </p>
  );
}
