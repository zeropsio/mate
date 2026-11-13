/**
 * Read access asked and answered under who has access (`useReadAccessRequests`). A person sees, for
 * each place Zerops does not show them, *Ask for read access*, then that they asked. An organization
 * owner or admin sees each open request for a place here: *Grant read access* gives that person read
 * on that one place at Zerops (`set-project-access`) and then closes the request; *Decline* closes it.
 * Once the person reaches the place already, *Close as granted* closes it as granted instead.
 * HQ only records and lists requests; it grants nothing. A person who reaches none of the project
 * sees the same asks on its page (`HiddenEnvironmentAsks`).
 */
import { useAtomValue } from "@effect/atom-react";
import type { ReadAccessRequest } from "@t3tools/client-runtime/zerops/hq";
import type { ReactNode } from "react";

import { hqNavigationAtom } from "~/state/zerops";
import { useReadAccessRequests } from "~/zerops/useReadAccessRequests";

import { Button } from "../../ui/button";
import { environmentTitle } from "../place/place.logic";
import { CELL_WORDS, cellChange, type AccessTableView } from "./accessTable.logic";

export function ReadAccessRequests({
  view,
  orgId,
}: {
  readonly view: AccessTableView;
  readonly orgId: string | null;
}) {
  const asks = useReadAccessRequests(view.kind === "table");
  if (view.kind !== "table" || !asks.available || asks.read.state !== "known" || orgId === null)
    return null;
  const open = asks.read.requests;
  const places = view.columns.filter(({ kind }) => kind !== "mate");
  const said = Object.values(asks.troubles);

  const lines = view.editable
    ? open.flatMap((request) => {
        const place = places.find(({ projectId }) => projectId === request.projectId);
        if (place === undefined) return [];
        // A member who reaches none of the app is a candidate, not a row: still in the organization.
        const row = view.rows.find(({ userId }) => userId === request.userId);
        const candidate = view.candidates.find(({ userId }) => userId === request.userId);
        const person =
          row !== undefined
            ? { name: row.name, clientUserId: row.key, memberRole: row.roleCode }
            : candidate !== undefined
              ? {
                  name: candidate.name,
                  clientUserId: candidate.clientUserId,
                  memberRole: undefined,
                }
              : undefined;
        const level =
          row !== undefined
            ? row.cells.find(({ projectId }) => projectId === place.projectId)?.level
            : candidate !== undefined
              ? place.unread
                ? "unknown"
                : "none"
              : undefined;
        // Read or more already (given here before the close failed, or from the table): the ask is met.
        const met = level === "read" || level === "basic" || level === "full" || level === "owner";
        const busy = asks.busy.has(request.id);
        return [
          <li className="flex flex-wrap items-center gap-2" key={request.id}>
            <span className="text-sm text-foreground">
              {person?.name ?? "Someone no longer in the organization"} asks for read access to{" "}
              {place.label}
              {level === undefined || level === "none" ? "." : ` (has ${CELL_WORDS[level]} now).`}
            </span>
            {person !== undefined && level === "none" ? (
              <Button
                disabled={busy}
                onClick={() =>
                  asks.grant(request, {
                    kind: "set-project-access",
                    orgId,
                    changes: [
                      cellChange({
                        clientUserId: person.clientUserId,
                        memberRole: person.memberRole,
                        projectId: place.projectId,
                        choice: "read",
                      }),
                    ],
                  })
                }
                size="sm"
              >
                Grant read access
              </Button>
            ) : null}
            {met ? (
              <Button
                disabled={busy}
                onClick={() => asks.closeGranted(request)}
                size="sm"
                variant="secondary"
              >
                Close as granted
              </Button>
            ) : (
              <Button
                disabled={busy}
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

  return <ReadAccessSection lines={lines} said={said} />;
}

/**
 * The same asks on the page of a person who reaches none of the project (`UndrawnGroupDetail`):
 * its people are not drawn there, and its hidden environments are all HQ names of it.
 */
export function HiddenEnvironmentAsks({ groupId }: { readonly groupId: string }) {
  const hidden = useHiddenEnvironments(groupId);
  const asks = useReadAccessRequests(hidden !== undefined);
  if (hidden === undefined || !asks.available || asks.read.state !== "known") return null;
  return (
    <ReadAccessSection
      lines={askLines(
        hidden.map(({ id, tier }) => ({ projectId: id, label: environmentTitle(tier, "") })),
        asks.read.requests,
        asks,
      )}
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
        <span className="text-sm text-foreground">
          {place.label}: Zerops doesn’t show you this place.
        </span>
        {asked ? (
          <span className="text-sm text-muted-foreground">Read access asked</span>
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

function ReadAccessSection({
  lines,
  said,
}: {
  readonly lines: ReadonlyArray<ReactNode>;
  readonly said: ReadonlyArray<string>;
}) {
  if (lines.length === 0 && said.length === 0) return null;
  return (
    <section aria-label="Read access" className="ov-sec" data-zerops-surface="read-access">
      <h3 className="ov-sec-name">Read access</h3>
      <ul className="flex flex-col gap-2">{lines}</ul>
      {said.map((line) => (
        <p className="ov-sec-empty" data-tone="failed" key={line} role="alert">
          {line}
        </p>
      ))}
    </section>
  );
}
