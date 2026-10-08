import {
  conversationPhrase,
  type ConversationView,
  type RouteGate,
  type RouteGatePhrase,
} from "@t3tools/client-runtime/zerops/environments";
import type { WebMateVoice as MateVoice } from "../zerops/mateNoticeVoice";
import { zeropsProjectUrl } from "@t3tools/client-runtime/zerops/serviceMap";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { ZeropsOrganizationScope } from "../components/zerops/ZeropsOrganizationScope";
import { MateVoiceContext } from "../zerops/mateVoiceContext";
import { Button } from "../components/ui/button";
import type { RecoveryNotice } from "../zerops/mateRecovery.logic";
import { MateConnectionState } from "../components/zerops/ZeropsMateEmptyState";
import { PortalGate } from "../components/ui/portal-gate";
import { useZeropsSession } from "../zerops/ZeropsSessionProvider";

/**
 * What a route renders under the route gate (DESIGN §4.8). The outlet keeps its place in the tree
 * whether or not a banner shows over it, so a verdict on its way somewhere — a restart, a
 * reconnect — never remounts the conversation; only `wait`, `choose-organization` and
 * `unavailable` replace it. A conversation its project's access no longer vouches for (DESIGN §9
 * C1b) stays mounted with its content, drafts and floating layers hidden, and its cause in place.
 */
export function RouteGateView({
  gate,
  phrase,
  projectId,
  conversation,
  recoveryPhrase,
  projectUnavailable = false,
  voice,
  stage,
  children,
}: {
  readonly gate: RouteGate;
  readonly phrase: RouteGatePhrase;
  /** What the route's Mate link says, and where (`mateVoice`). */
  readonly voice: MateVoice;
  /** The Mate's stage, drawn where the route waits for its conversation. */
  readonly stage: ReactNode;
  /** The route's Zerops project, for "Open in Zerops"; null while it is not known. */
  readonly projectId: string | null;
  readonly conversation: ConversationView;
  readonly recoveryPhrase?: RecoveryNotice | null;
  /** An owner-proven access denial or deletion outranks a detail read's secondary failure. */
  readonly projectUnavailable?: boolean;
  /** The route's outlet. */
  readonly children: ReactNode;
}) {
  switch (gate.kind) {
    case "outlet": {
      const suppressed = conversation.kind === "suppressed";
      const cause =
        suppressed && recoveryPhrase != null ? recoveryPhrase : conversationPhrase(conversation);
      return (
        <>
          <PortalGate closed={suppressed}>
            <div
              inert={suppressed}
              aria-hidden={suppressed || undefined}
              className={suppressed ? "hidden" : "contents"}
            >
              {/* The link's words go to the one banner over the composer (`mateVoice`). */}
              <MateVoiceContext value={voice}>{children}</MateVoiceContext>
            </div>
          </PortalGate>
          {cause.text === null ? null : (
            <RouteGateWords
              phrase={cause}
              projectId={projectId}
              tone={suppressed ? recoveryPhrase?.tone : undefined}
            />
          )}
        </>
      );
    }
    case "choose-organization":
      return (
        <div className="flex flex-col items-start gap-5 p-8">
          <p className="text-sm text-muted-foreground">{phrase.text}</p>
          <RouteGateOrganizationChoice />
        </div>
      );
    case "wait":
      if (projectUnavailable && recoveryPhrase != null)
        return (
          <RouteGateWords phrase={recoveryPhrase} projectId={null} tone={recoveryPhrase.tone} />
        );
      // The Mate's stage (`MateLinkStage`, drawn by the root): face asleep, name, the link's line.
      return stage;
    case "unavailable":
      if (projectUnavailable && recoveryPhrase != null)
        return (
          <RouteGateWords phrase={recoveryPhrase} projectId={null} tone={recoveryPhrase.tone} />
        );
      return stage ?? <RouteGateWords phrase={phrase} projectId={projectId} />;
  }
}

/** A route's own words where nothing else stands: centred, with each verb once. */
function RouteGateWords({
  phrase,
  projectId,
  tone,
}: {
  readonly tone?: RecoveryNotice["tone"] | undefined;
  readonly phrase: RouteGatePhrase | RecoveryNotice;
  readonly projectId: string | null;
}) {
  return (
    <MateConnectionState
      mate={null}
      face="sleep"
      headline={
        "headline" in phrase ? phrase.headline : (phrase.text ?? "The conversation is unavailable.")
      }
      secondary={"secondary" in phrase ? phrase.secondary : ""}
      severity={tone === "error" ? "danger" : tone === "warning" ? "attention" : "info"}
      actions={
        <div className="flex flex-wrap items-center justify-center gap-2">
          <RouteGateActions phrase={phrase} projectId={projectId} />
        </div>
      }
    />
  );
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
