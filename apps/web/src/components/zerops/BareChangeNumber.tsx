/**
 * "change #17" in a Mate's words, drawn as that change's chip. Agents name changes by number
 * (zcp's answers carry no address), and numbers grow per repository: the words become a chip only
 * where the conversation's application says which repository the number is in — the one
 * repository whose changes carry it, else the application's only repository. Anything else stays
 * the words as written.
 */
import type { ScopedThreadRef } from "@t3tools/contracts";
import { changeUrl } from "@t3tools/shared/hqChanges";
import { Children, cloneElement, isValidElement, type ReactNode } from "react";

import { useMateOfEnvironment } from "~/zerops/accountEnvironments";
import { useHqAddress } from "~/zerops/projectFlows";
import { useApplicationOfProject } from "~/zerops/useGitEnvironmentFormInputs";
import { useHqAppDetail } from "~/zerops/useHqAppDetail";
import { useKnownMate } from "~/zerops/useZeropsMates";
import { ZeropsChangeLinkChip } from "./ZeropsChangeLinkChip";

const BARE_CHANGE = /\b[Cc]hange #([1-9][0-9]{0,5})\b/gu;

/** The repository `number` names a change in: the only one whose changes carry it, else the only one. */
export function repositoryOfChangeNumber(
  number: number,
  repos: ReadonlyArray<string>,
  changes: ReadonlyArray<{ readonly repo: string; readonly number: number }>,
): string | null {
  const carrying = new Set(
    changes.filter((change) => change.number === number).map((change) => change.repo),
  );
  if (carrying.size === 1) return [...carrying][0] ?? null;
  if (carrying.size === 0 && repos.length === 1) return repos[0] ?? null;
  return null;
}

function BareChangeNumber({
  number,
  threadRef,
  children,
}: {
  readonly number: number;
  readonly threadRef: ScopedThreadRef;
  readonly children: string;
}) {
  const mate = useKnownMate(threadRef.environmentId);
  const location = useMateOfEnvironment(threadRef.environmentId);
  const application = useApplicationOfProject(location?.projectId ?? mate?.projectId);
  const detail = useHqAppDetail(application?.id ?? null);
  const hqAddress = useHqAddress();
  const repo =
    detail.repos === undefined
      ? null
      : repositoryOfChangeNumber(
          number,
          detail.repos.map((entry) => entry.name),
          detail.changes ?? [],
        );
  if (application === undefined || hqAddress === undefined || repo === null) return children;
  return (
    <ZeropsChangeLinkChip href={changeUrl(hqAddress, application.id, repo, number)} inferred>
      {children}
    </ZeropsChangeLinkChip>
  );
}

function bareChangeText(text: string, threadRef: ScopedThreadRef): ReactNode {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(BARE_CHANGE)) {
    const start = match.index;
    if (start > cursor) nodes.push(text.slice(cursor, start));
    nodes.push(
      <BareChangeNumber
        key={`${start}:${match[1]}`}
        number={Number(match[1])}
        threadRef={threadRef}
      >
        {match[0]}
      </BareChangeNumber>,
    );
    cursor = start + match[0].length;
  }
  if (cursor === 0) return text;
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

/** Markdown children with each bare "change #N" outside code and links resolved to its chip. */
export function renderBareChangeNumbers(
  children: ReactNode,
  threadRef: ScopedThreadRef | undefined,
): ReactNode {
  if (threadRef === undefined) return children;
  return Children.map(children, (child) => {
    if (typeof child === "string") return bareChangeText(child, threadRef);
    if (!isValidElement<{ children?: ReactNode; node?: { tagName?: string } }>(child)) return child;
    // Custom react-markdown components replace the intrinsic type; the hast node names the tag.
    const tag = typeof child.type === "string" ? child.type : child.props.node?.tagName;
    if (tag === "code" || tag === "a" || !("children" in child.props)) return child;
    return cloneElement(child, undefined, renderBareChangeNumbers(child.props.children, threadRef));
  });
}
