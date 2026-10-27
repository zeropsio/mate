/**
 * The Chief page (`/chief`), which the menu's top row opens while the person has no Chief to talk
 * to: the stage a Mate's empty conversation stands on (`MateEmptyStateView`) — the Chief's mark,
 * one headline, the sentence under it, one slot — saying what a Chief is over *Set up Chief*. The
 * press runs the setup here (`chiefSetup.ts`): the button hands over to its steps in place, a step
 * that stopped says why over *Try again*, and once it is set up the page is the Chief's own view
 * while its container comes up (`ZeropsMateComingPage`), which hands over to its conversation.
 */
import { useAccountHq, useCarriedCoreBuild } from "~/zerops/accountHq";
import { startChiefSetup, tryChiefSetupAgain, useChiefSetup } from "~/zerops/chiefSetup";
import { CHIEF_NAME } from "~/zerops/chief";
import { useOwnChief } from "~/zerops/ownChief";
import { useOrgOffers } from "~/zerops/useHqOffers";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";
import { MATE_SHAPE_OF_TINT } from "@t3tools/shared/brand";
import { hqBehind } from "~/components/zerops/ZeropsHqUpdate.logic";
import { useAtomValue } from "@effect/atom-react";
import { hqStandingAtom } from "~/state/zerops";

import { Button } from "../../ui/button";
import { ArrivalSwap } from "../ArrivalSwap";
import { Progress } from "../../ui/progress";
import { MateFaceAsMark } from "../primitives";
import { MateComingFrame, MateComingHeader, ZeropsMateComingPage } from "../ZeropsMateComingPage";
import { MateEmptyStateView, type MateEmptyComing } from "../ZeropsMateEmptyState";
import { CHIEF_SETUP_DOING, CHIEF_SETUP_ESTIMATE_MS, chiefSetupSteps } from "./chiefSetup.logic";
import { chiefPageView, type ChiefPageView } from "./chiefTop.logic";

/** The Chief as its page draws it before it exists: the product's mark, its name. */
const CHIEF_DRAWN = {
  name: CHIEF_NAME,
  tint: "slate",
  shape: MATE_SHAPE_OF_TINT.slate,
  project: undefined,
  connected: false,
  chief: true,
} as const;

export function ChiefPage() {
  const own = useOwnChief();
  const { setup, startedAtMs } = useChiefSetup();
  const { activeOrganization } = useZeropsSession();
  const orgId = activeOrganization?.id;
  const accountHq = useAccountHq(orgId);
  const create = useOrgOffers()("create_app");
  // An HQ on an older Core than this app's records no Chief: its update comes first.
  const standing = useAtomValue(hqStandingAtom);
  const carried = useCarriedCoreBuild();
  const answering = standing.kind === "healthy" ? standing.build : undefined;
  const view = chiefPageView({
    own,
    setup,
    hq:
      accountHq.hq.kind === "official"
        ? hqBehind({ hq: accountHq.hq, answering, carried })
          ? "behind"
          : "official"
        : accountHq.status === "ready"
          ? "none"
          : "reading",
    mayCreate: create.kind !== "refused",
  });
  if (view.kind === "coming")
    return <ZeropsMateComingPage key={view.projectId} projectId={view.projectId} />;
  return (
    <MateFaceAsMark.Provider value>
      <MateComingFrame
        header={<MateComingHeader arriving mate={{ ...CHIEF_DRAWN, projectUrl: undefined }} />}
      >
        {view.kind === "reading" ? null : (
          <ChiefStage
            onAgain={tryChiefSetupAgain}
            onSetUp={startChiefSetup}
            startedAtMs={startedAtMs}
            view={view}
          />
        )}
      </MateComingFrame>
    </MateFaceAsMark.Provider>
  );
}

/** What a Chief is for, in the person's words: one headline and the sentence under it. */
const CHIEF_IS = {
  headline: "One Mate for all your projects.",
  sentence:
    "Ask it what runs where, what it costs, or who has access. Anything it would change waits for your approval.",
} as const;

/**
 * The page's stage in each of its states before the Chief exists (`chiefPageView`), for the page
 * and a design harness alike: props only.
 */
export function ChiefStage({
  view,
  onSetUp,
  onAgain,
  startedAtMs = null,
}: {
  readonly view: Exclude<ChiefPageView, { kind: "reading" | "coming" }>;
  readonly onSetUp: () => void;
  readonly onAgain: () => void;
  /** When this tab pressed *Set up Chief*: the row's clock; `null` when unknown. */
  readonly startedAtMs?: number | null;
}) {
  const coming = ((): MateEmptyComing => {
    switch (view.kind) {
      case "offer":
        return {
          kind: "coming",
          face: "idle",
          headline: CHIEF_IS.headline,
          sentence: CHIEF_IS.sentence,
          below: (
            <ArrivalSwap id="offer" kind="slot">
              <div className="flex flex-col items-center gap-3">
                <Button
                  data-zerops-surface="chief-set-up"
                  disabled={view.blocked !== undefined}
                  onClick={onSetUp}
                  size="lg"
                  variant="primary"
                >
                  Set up Chief
                </Button>
                {view.blocked === undefined ? null : (
                  <p className="text-sm text-muted-foreground">{view.blocked}</p>
                )}
              </div>
            </ArrivalSwap>
          ),
        };
      case "steps": {
        const stopped = view.setup.phase === "failed";
        const steps = chiefSetupSteps(view.setup);
        const on = steps.findIndex((step) => step.state === "active" || step.state === "failed");
        const at = on === -1 ? steps.length - 1 : on;
        return {
          kind: stopped ? "failed" : "coming",
          face: stopped ? "needs" : "working",
          headline: stopped ? "Setting up your Chief stopped." : "Setting up your Chief.",
          sentence: stopped
            ? "Try again picks up at the step that stopped; finished steps are kept."
            : "Keep this tab open until these steps are done. Then Chief comes up on its own.",
          pressed: true,
          below: (
            <ArrivalSwap id="steps" kind="slot">
              <div className="w-full max-w-md text-start" data-zerops-surface="chief-setup">
                <Progress
                  at={at}
                  estimateMs={CHIEF_SETUP_ESTIMATE_MS}
                  identity={view.setup.birthId}
                  label="Setting up your Chief"
                  startedAtMs={startedAtMs}
                  steps={CHIEF_SETUP_DOING}
                  view={
                    stopped
                      ? {
                          state: "failed",
                          cause: `${CHIEF_SETUP_DOING[at]} stopped. ${steps[at]?.detail ?? ""}`,
                          action: (
                            <Button onClick={onAgain} size="sm">
                              Try again
                            </Button>
                          ),
                        }
                      : undefined
                  }
                />
              </div>
            </ArrivalSwap>
          ),
        };
      }
    }
  })();
  return (
    <MateEmptyStateView
      coming={coming}
      mate={CHIEF_DRAWN}
      phase={null}
      signIn={null}
      signInRequired={false}
      unknown={null}
    />
  );
}
