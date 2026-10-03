/**
 * A New project's first Mate before the platform has made its project (`/mate/new/$birthId`):
 * where Create lands, at once (the owner, 2026-09-30: "you should go to the mate detail and the
 * only diff would be the progress"). It is the view Add a Mate lands on (`ZeropsMateComingPage`) —
 * the header line with the Mate's face and name, its face asleep a third of the way down, "Vera is
 * coming up on Acme CRM." — with the project's own steps before the Mate's in its progress
 * (`newProjectBirth.ts`): Git hosting where the account had none, then the project, under its
 * name. A step that stops says why here, with *Try again*, which resumes from it; one the platform
 * may have made anyway, with the way to the projects, where it would be listed.
 *
 * The moment the platform takes the Mate's project, that Mate's own view takes the route in place
 * of this one, painting the same frame (`MateComingFrame`). A creation this tab no longer holds —
 * the page was reloaded before the platform took it — says so in the route gate's words, with the
 * way to the projects: nothing here hands the person to another screen on its own.
 */
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

import { arrivalHeaderFace } from "~/zerops/mateArrival";
import { mateOpeningPhrase } from "~/zerops/mateComing";
import {
  newProjectComing,
  newProjectHandOver,
  newProjectProgress,
  retryNewProjectBirth,
  useNewProjectBirths,
} from "~/zerops/newProjectBirth";
import { useSecondsNowMs } from "~/zerops/useNowMs";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import {
  ComingBelow,
  comingSentenceOf,
  MateComingFrame,
  MateComingHeader,
  personOf,
} from "./ZeropsMateComingPage";
import { MateOpeningLine } from "./MateLinkLine";
import { MateEmptyStateView, type MateEmptyComing } from "./ZeropsMateEmptyState";

/** Who a creation this tab does not hold is: nobody it can name, in the slate face. */
const NOBODY = {
  name: "This Mate",
  tint: "slate",
  shape: "squircle",
  project: undefined,
  connected: false,
} as const;

export function ZeropsNewProjectComingPage({ birthId }: { readonly birthId: string }) {
  const navigate = useNavigate();
  const { user } = useZeropsSession();
  // The person's own step wears their picture.
  const you = useMemo(() => personOf(user), [user]);
  const birth = useNewProjectBirths((state) => state.births[birthId]);

  // The platform took its Mate's project: that Mate's view takes the route, in place of this one.
  const handOver = useMemo(() => newProjectHandOver(birth), [birth]);
  useEffect(() => {
    if (handOver !== null) void navigate(handOver);
  }, [handOver, navigate]);

  // Its clock runs while it does, from the press.
  const nowMs = useSecondsNowMs(
    birth !== undefined && birth.failed === null && birth.projectId === null,
  );
  const progress = useMemo(
    () => (birth === undefined ? undefined : newProjectProgress(birth, null, nowMs)),
    [birth, nowMs],
  );

  const mate =
    birth === undefined
      ? NOBODY
      : {
          name: birth.botName,
          tint: birth.face.tint,
          shape: birth.face.shape,
          project: birth.name,
          connected: false,
        };
  const projects = <Link to="/zerops" />;
  const coming = birth === undefined ? undefined : newProjectComing(birth);
  const view: MateEmptyComing =
    coming === undefined
      ? {
          kind: "unreachable",
          below: (
            <MateOpeningLine
              onTryNow={undefined}
              phrase={mateOpeningPhrase(
                { kind: "unreachable", reachability: null },
                { nowMs, mateName: mate.name },
              )}
              projects={projects}
              projectUrl={undefined}
            />
          ),
        }
      : {
          kind: coming.kind,
          sentence: comingSentenceOf({ coming, progress, nowMs }),
          below: (
            <ComingBelow
              coming={coming}
              mate={mate}
              nowMs={nowMs}
              onTryAgain={() => {
                retryNewProjectBirth(birthId);
              }}
              progress={progress}
              projects={projects}
              you={you}
            />
          ),
        };

  return (
    <MateComingFrame
      header={
        <MateComingHeader
          face={arrivalHeaderFace({
            kind: view.kind,
            over: false,
            signInRequired: true,
            connected: false,
          })}
          mate={{ ...mate, projectUrl: undefined }}
        />
      }
    >
      <MateEmptyStateView
        coming={view}
        mate={mate}
        onRetry={() => undefined}
        phase={null}
        signIn={null}
        signInRequired={false}
        unknown={null}
      />
    </MateComingFrame>
  );
}
