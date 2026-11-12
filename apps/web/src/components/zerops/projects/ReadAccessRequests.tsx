/**
 * Read access asked and answered under who has access (`useReadAccessRequests`). A person sees, for
 * each place Zerops does not show them, *Ask for read access*, then that they asked. An organization
 * owner or admin sees each open request for a place here: *Grant read access* gives that person read
 * on that one place at Zerops (`set-project-access`) and then closes the request; *Decline* closes it.
 * HQ only records and lists requests; it grants nothing.
 */
import { useReadAccessRequests } from "~/zerops/useReadAccessRequests";

import { Button } from "../../ui/button";
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
        const row = view.rows.find(({ userId }) => userId === request.userId);
        const level = row?.cells.find(({ projectId }) => projectId === place.projectId)?.level;
        const busy = asks.busy.has(request.id);
        return [
          <li className="flex flex-wrap items-center gap-2" key={request.id}>
            <span className="text-sm text-foreground">
              {row?.name ?? "Someone no longer in the organization"} asks for read access to{" "}
              {place.label}
              {level === undefined || level === "none" ? "." : ` (has ${CELL_WORDS[level]} now).`}
            </span>
            {row !== undefined && level === "none" ? (
              <Button
                disabled={busy}
                onClick={() =>
                  asks.grant(request, {
                    kind: "set-project-access",
                    orgId,
                    changes: [
                      cellChange({
                        clientUserId: row.key,
                        memberRole: row.roleCode,
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
            <Button
              disabled={busy}
              onClick={() => asks.decline(request)}
              size="sm"
              variant="secondary"
            >
              Decline
            </Button>
          </li>,
        ];
      })
    : places
        .filter(({ unread }) => unread)
        .map((place) => {
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
