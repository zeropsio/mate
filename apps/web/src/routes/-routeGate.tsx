import type { RouteGate, RouteGatePhrase } from "@t3tools/client-runtime/zerops/environments";
import { zeropsProjectUrl } from "@t3tools/client-runtime/zerops/serviceMap";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { ZeropsOrganizationScope } from "../components/zerops/ZeropsOrganizationScope";
import { Button } from "../components/ui/button";
import { useZeropsSession } from "../zerops/ZeropsSessionProvider";

/**
 * What a route renders under the route gate (DESIGN §4.8). The outlet keeps its place in the tree
 * whether or not a banner shows over it, so a verdict on its way somewhere — a restart, a
 * reconnect — never remounts the conversation; only `wait`, `choose-organization` and
 * `unavailable` replace it.
 */
export function RouteGateView({
  gate,
  phrase,
  projectId,
  children,
}: {
  readonly gate: RouteGate;
  readonly phrase: RouteGatePhrase;
  /** The route's Zerops project, for "Open in Zerops"; null while it is not known. */
  readonly projectId: string | null;
  /** The route's outlet. */
  readonly children: ReactNode;
}) {
  switch (gate.kind) {
    case "outlet":
      return (
        <>
          {children}
          {phrase.text === null ? null : (
            <div
              role="status"
              className="fixed top-3 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md"
            >
              <span>{phrase.text}</span>
              <RouteGateActions phrase={phrase} projectId={projectId} />
            </div>
          )}
        </>
      );
    case "choose-organization":
      return (
        <div className="flex flex-col items-start gap-5 p-8">
          <p className="text-sm text-muted-foreground">{phrase.text}</p>
          <RouteGateOrganizationChoice />
        </div>
      );
    case "wait":
    case "unavailable":
      return (
        <div className="flex flex-col items-start gap-3 p-8">
          <p className="text-sm text-muted-foreground">{phrase.text}</p>
          <RouteGateActions phrase={phrase} projectId={projectId} />
        </div>
      );
  }
}

/**
 * Each verb once. Start, Enable and Restart are the projects screen's verbs (`useMateActions`),
 * so until the route carries the container machine's own they send the person there.
 */
function RouteGateActions({
  phrase,
  projectId,
}: {
  readonly phrase: RouteGatePhrase;
  readonly projectId: string | null;
}) {
  const openInZerops = projectId !== null && phrase.actions.includes("open-in-zerops");
  const toProjects = phrase.actions.some(
    (action) =>
      action === "go-to-projects" ||
      action === "start" ||
      action === "enable" ||
      action === "restart" ||
      (action === "open-in-zerops" && projectId === null),
  );
  if (!openInZerops && !toProjects) return null;
  return (
    <>
      {openInZerops ? (
        <Button
          render={<a href={zeropsProjectUrl(projectId)} target="_blank" rel="noreferrer" />}
          size="sm"
          variant="secondary"
        >
          Open in Zerops
        </Button>
      ) : null}
      {toProjects ? (
        <Button render={<Link to="/zerops" />} size="sm" variant="secondary">
          Go to projects
        </Button>
      ) : null}
    </>
  );
}

/** The organization picker in place: choosing one keeps the person on the route they opened. */
function RouteGateOrganizationChoice() {
  const { organizations, organizationStatus, selectOrganization } = useZeropsSession();
  return (
    <ZeropsOrganizationScope
      organizations={organizations}
      status={organizationStatus}
      onSelect={(membershipId) => {
        void selectOrganization(membershipId);
      }}
    />
  );
}
