/**
 * Read access asked and answered under who has access (`useReadAccessRequests`). A person sees, for
 * each place Zerops does not show them, *Ask for read access*, then that they asked. An organization
 * owner or admin sees each open request for a place here: *Grant read access* — or, once the person
 * reaches the place already, *Close as granted* — is one access change HQ runs (`readAccess`), which
 * gives that person read on that one place at Zerops where they lack it and ends the request;
 * *Decline* closes it. While HQ runs the viewer's grant, the person's request waits and the change is
 * said under the requests, with its *Continue* or *Delete* (`AccessOperationRow`); once HQ ended it
 * the list is read again. A person who reaches none of the project's stages and productions sees the
 * same asks on its page (`HiddenEnvironmentAsks`).
 */
import { useAtomValue } from "@effect/atom-react";
import type { AccessOperationRow as AccessOperation } from "@t3tools/client-runtime/data";
import type { ReadAccessRequest } from "@t3tools/client-runtime/zerops/hq";
import type { HqHiddenEnvironment } from "@t3tools/shared/hqStream";
import { useEffect, useRef, type ReactNode } from "react";

import { hqNavigationAtom } from "~/state/zerops";
import { useReadAccessRequests } from "~/zerops/useReadAccessRequests";

import { AccessOperationRow } from "../../settings/AccessOperationRow";
import { Button } from "../../ui/button";
import { environmentTitle } from "../place/place.logic";
import { SectionLabel } from "../system/SectionLabel";
import { CELL_WORDS, type AccessTableView } from "./accessTable.logic";

export function ReadAccessRequests({
  view,
  orgId,
  changes,
  onContinue,
  onDelete,
}: {
  readonly view: AccessTableView;
  readonly orgId: string | null;
  /** The viewer's access changes HQ runs, waits on or stopped (`accessOperations`). */
  readonly changes: ReadonlyArray<AccessOperation>;
  readonly onContinue?: (id: string) => Promise<void>;
  readonly onDelete?: (id: string) => Promise<void>;
}) {
  const asks = useReadAccessRequests(view.kind === "table");
  const grants = changes.filter(({ kind }) => kind === "readAccess");
  // A grant whose key left was ended by HQ, its request with it: the list is read again.
  const grantIds = grants.map(({ id }) => id).join(",");
  const seen = useRef(grantIds);
  const { again } = asks;
  useEffect(() => {
    const now = new Set(grantIds.split(","));
    const left = seen.current.split(",").some((id) => id !== "" && !now.has(id));
    seen.current = grantIds;
    if (left) again();
  }, [again, grantIds]);
  if (view.kind !== "table" || !asks.available || asks.read.state !== "known" || orgId === null)
    return null;
  const open = asks.read.requests;
  const places = view.columns.filter(({ kind }) => kind !== "mate");
  const said = Object.values(asks.troubles);
  const nameOf = (userId: string | null) =>
    userId === null
      ? undefined
      : (view.rows.find((row) => row.userId === userId)?.name ??
        view.candidates.find((candidate) => candidate.userId === userId)?.name);

  const lines = view.editable
    ? open.flatMap((request) => {
        const place = places.find(({ projectId }) => projectId === request.projectId);
        if (place === undefined) return [];
        // A member who reaches none of the app is a candidate, not a row: still in the organization.
        const row = view.rows.find(({ userId }) => userId === request.userId);
        const candidate = view.candidates.find(({ userId }) => userId === request.userId);
        const name = row?.name ?? candidate?.name;
        const level =
          row !== undefined
            ? row.cells.find(({ projectId }) => projectId === place.projectId)?.level
            : candidate !== undefined
              ? place.unread
                ? "unknown"
                : "none"
              : undefined;
        // Read or more already (from the table, or given before): the ask is met.
        const met = level === "read" || level === "basic" || level === "full" || level === "owner";
        const pressing = asks.busy.has(request.id);
        // The viewer's grant of this request runs, waits or stopped: said below, never pressed
        // twice. Decline stays: HQ ends the grant with the request.
        const granting =
          pressing ||
          grants.some(
            ({ userId, projectIds }) =>
              userId === request.userId && projectIds?.includes(request.projectId) === true,
          );
        return [
          <li className="flex flex-wrap items-center gap-2" key={request.id}>
            <span className="text-body text-foreground">
              {name ?? "Someone no longer in the organization"} asks for read access to{" "}
              {place.label}
              {level === undefined || level === "none" ? "." : ` (has ${CELL_WORDS[level]} now).`}
            </span>
            {name !== undefined && level === "none" ? (
              <Button disabled={granting} onClick={() => asks.grant(request)} size="sm">
                Grant read access
              </Button>
            ) : null}
            {met ? (
              <Button
                disabled={granting}
                onClick={() => asks.grant(request)}
                size="sm"
                variant="secondary"
              >
                Close as granted
              </Button>
            ) : (
              <Button
                disabled={pressing}
                onClick={() => asks.decline(request)}
                size="sm"
                variant="secondary"
              >
                Decline
              </Button>
            )}
          </li>,
        ];
      })
    : askLines(
        places.filter(({ unread }) => unread),
        open,
        asks,
      );

  const ongoing = view.editable
    ? grants.flatMap((change) => {
        const name = nameOf(change.userId);
        return name === undefined
          ? []
          : [
              <li className="flex flex-wrap items-baseline gap-x-2 text-body" key={change.id}>
                <span className="text-foreground">{name}:</span>
                <AccessOperationRow
                  operation={change}
                  {...(onContinue === undefined ? {} : { onContinue })}
                  {...(onDelete === undefined ? {} : { onDelete })}
                />
              </li>,
            ];
      })
    : [];

  return <ReadAccessSection lines={[...lines, ...ongoing]} said={said} />;
}

/**
 * The same asks in the main column of the drawn project page of a person who reaches none of its
 * stages and productions (`accessAsksOf`): `hidden` is all HQ names of it.
 */
export function HiddenEnvironmentAsks({
  hidden,
}: {
  readonly hidden: ReadonlyArray<HqHiddenEnvironment>;
}) {
  const asks = useReadAccessRequests(hidden.length > 0);
  if (hidden.length === 0 || !asks.available || asks.read.state !== "known") return null;
  return (
    <ReadAccessSection
      lines={askLines(
        hidden.map(({ id, tier }) => ({ projectId: id, label: environmentTitle(tier, "") })),
        asks.read.requests,
        asks,
      )}
      page
      said={Object.values(asks.troubles)}
    />
  );
}

/**
 * The group's stages and productions Zerops does not list to the viewer, by id and tier alone as
 * HQ names them (`hiddenEnvironments`); `undefined` where the viewer reaches every place.
 */
export function useHiddenEnvironments(groupId: string) {
  return useAtomValue(hqNavigationAtom).structure?.apps.find(({ id }) => id === groupId)
    ?.hiddenEnvironments;
}

/** One line per place Zerops does not show the viewer: *Ask for read access*, then that they asked. */
function askLines(
  places: ReadonlyArray<{ readonly projectId: string; readonly label: string }>,
  open: ReadonlyArray<ReadAccessRequest>,
  asks: Pick<ReturnType<typeof useReadAccessRequests>, "ask" | "busy">,
): ReadonlyArray<ReactNode> {
  return places.map((place) => {
    const asked = open.some(({ projectId }) => projectId === place.projectId);
    return (
      <li className="flex flex-wrap items-center gap-2" key={place.projectId}>
        <span className="text-body text-foreground">
          {place.label}: Zerops doesn’t show you this place.
        </span>
        {asked ? (
          <span className="text-body text-muted-foreground">Read access asked</span>
        ) : (
          <Button
            disabled={asks.busy.has(place.projectId)}
            onClick={() => asks.ask(place.projectId)}
            size="sm"
            variant="secondary"
          >
            Ask for read access
          </Button>
        )}
      </li>
    );
  });
}

/** `page`: the page's own section in the project page's main column; else a card's under who has access. */
function ReadAccessSection({
  lines,
  said,
  page = false,
}: {
  readonly lines: ReadonlyArray<ReactNode>;
  readonly said: ReadonlyArray<string>;
  readonly page?: boolean;
}) {
  if (lines.length === 0 && said.length === 0) return null;
  const body = (
    <>
      <ul className="flex flex-col gap-2">{lines}</ul>
      {said.map((line) => (
        <p className="ov-sec-empty" data-tone="failed" key={line} role="alert">
          {line}
        </p>
      ))}
    </>
  );
  if (page)
    return (
      <section
        aria-labelledby="pp-read-access"
        className="pp-group"
        data-zerops-surface="read-access"
      >
        <SectionLabel id="pp-read-access">Read access</SectionLabel>
        {body}
      </section>
    );
  return (
    <section aria-label="Read access" className="ov-sec" data-zerops-surface="read-access">
      <h3 className="ov-sec-name">Read access</h3>
      {body}
    </section>
  );
}
