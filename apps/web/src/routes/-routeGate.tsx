import {
  conversationPhrase,
  type MateVoice,
  type ConversationView,
  type RouteGate,
  type RouteGatePhrase,
} from "@t3tools/client-runtime/zerops/environments";
import { zeropsProjectUrl } from "@t3tools/client-runtime/zerops/serviceMap";
import { Link } from "@tanstack/react-router";
import { lazy, Suspense, type ReactNode } from "react";

import type { EnvironmentId } from "@t3tools/contracts";

import type { Spoken } from "../components/zerops/MateLinkLine";
import { ZeropsOrganizationScope } from "../components/zerops/ZeropsOrganizationScope";
import { MateVoiceContext } from "../zerops/mateVoiceContext";
import { Button } from "../components/ui/button";
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
  voice,
  environmentId,
  children,
}: {
  readonly gate: RouteGate;
  readonly phrase: RouteGatePhrase;
  /** What the route's Mate link says, and where (`mateVoice`). */
  readonly voice: MateVoice;
  /** The route's environment, whose Mate the stage draws. */
  readonly environmentId: EnvironmentId | null;
  /** The route's Zerops project, for "Open in Zerops"; null while it is not known. */
  readonly projectId: string | null;
  readonly conversation: ConversationView;
  /** The route's outlet. */
  readonly children: ReactNode;
}) {
  switch (gate.kind) {
    case "outlet": {
      const suppressed = conversation.kind === "suppressed";
      const cause = conversationPhrase(conversation);
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
          {cause.text === null ? null : <RouteGateWords phrase={cause} projectId={projectId} />}
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
      // The Mate's stage: its face asleep, its name and its link's line, on one axis.
      return (
        <MateLinkStageLoaded
          environmentId={environmentId}
          projectId={projectId}
          voice={voice.surface === "none" ? SILENT_STAGE : voice}
        />
      );
    case "unavailable":
      return <RouteGateWords phrase={phrase} projectId={projectId} />;
  }
}

const SILENT_STAGE: Spoken = { surface: "stage", text: null, actions: [], processes: false };

/**
 * The Mate's stage draws its conversation's header, which brings the conversation's modules, so
 * the gate imports it apart — and starts that import as this module loads, in a browser, so the
 * stage is there before a reload while the Mate is down first needs it. Once loaded it renders
 * in the same frame; only a stage needed before its module arrived waits, drawing nothing.
 */
type MateLinkStageView = (typeof import("../components/zerops/MateLinkStage"))["MateLinkStage"];
let mateLinkStage: MateLinkStageView | null = null;
let mateLinkStageLoad: Promise<MateLinkStageView> | null = null;

function loadMateLinkStage(): Promise<MateLinkStageView> {
  mateLinkStageLoad ??= import("../components/zerops/MateLinkStage").then(
    (module) => (mateLinkStage = module.MateLinkStage),
    (cause: unknown) => {
      // A failed load is tried again when the stage is next needed.
      mateLinkStageLoad = null;
      throw cause;
    },
  );
  return mateLinkStageLoad;
}

if (typeof window !== "undefined") loadMateLinkStage().catch(() => undefined);

const MateLinkStageLazy = lazy(() => loadMateLinkStage().then((view) => ({ default: view })));

function MateLinkStageLoaded(props: Parameters<MateLinkStageView>[0]) {
  const Loaded = mateLinkStage;
  if (Loaded !== null) return <Loaded {...props} />;
  return (
    <Suspense fallback={null}>
      <MateLinkStageLazy {...props} />
    </Suspense>
  );
}

/** A route's own words where nothing else stands: centred, with each verb once. */
function RouteGateWords({
  phrase,
  projectId,
}: {
  readonly phrase: RouteGatePhrase;
  readonly projectId: string | null;
}) {
  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-sm text-muted-foreground" role="status">
        {phrase.text}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <RouteGateActions phrase={phrase} projectId={projectId} />
      </div>
    </div>
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
