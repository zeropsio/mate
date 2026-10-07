/** The name and face HQ's navigation gives each Mate, joined to its overview's environment. */
import type { EnvironmentId } from "@t3tools/contracts";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import { assignCandidateMateTints, mateShapeOf } from "../../zerops/mateTints.ts";
import { projectNameInApp, readZeropsMembership } from "../../zerops/groups.ts";
import type { ZeropsCandidate } from "../../zerops/candidates.ts";
import { zeropsProjectUrl } from "../../zerops/serviceMap.ts";
import { placementsScope } from "../families/hqNavigation.ts";
import { hqAppsScope } from "../families/hqNavigation.ts";
import type { Projection } from "../store.ts";
import { hqMateOverview } from "./hqMates.ts";
import type { HqPlacement } from "../../zerops/hq/placement.ts";
import { sameValue } from "./equal.ts";

export interface HqMateIdentity {
  readonly projectId: string;
  readonly environmentId?: EnvironmentId | undefined;
  readonly fullName: string;
  readonly name: string;
  readonly tint: MateTintId;
  readonly shape: MateShapeId;
  readonly project: string | undefined;
  readonly projectUrl: string;
  readonly standUp?: { readonly by: string } | undefined;
  readonly madeBy?: string | undefined;
  readonly runsWithoutSignIn?: boolean | undefined;
}

export const hqMateIdentities: Projection<string, Readonly<Record<string, HqMateIdentity>>> = {
  name: "hqMateIdentities",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) => {
    const rows: ZeropsCandidate[] = [];
    for (const projectId of read.members(placementsScope(orgId)).ids) {
      const fact = read.fact("placement", projectId);
      if (fact.kind !== "known" || !fact.value.name?.trim()) continue;
      const placement = fact.value;
      if (placement.kind !== "mate" && placement.kind !== "devstage") continue;
      const { face, birthId, ...record } = placement.mate ?? {};
      const mate =
        placement.mate == null
          ? placement.mate
          : {
              ...record,
              ...(face === undefined ? {} : { face }),
              ...(birthId === undefined ? {} : { birthId }),
            };
      let hq: HqPlacement;
      if (placement.appId === null) {
        if (mate == null) continue;
        hq = { appId: null, appName: null, kind: "mate", mate };
      } else {
        if (placement.appId === undefined) continue;
        const app = read.fact("hqApp", placement.appId);
        if (
          app.kind !== "known" ||
          app.value.name === undefined ||
          !read.members(hqAppsScope(orgId)).ids.includes(placement.appId)
        )
          continue;
        hq = {
          appId: placement.appId,
          appName: app.value.name,
          kind: placement.kind,
          mate,
        };
      }
      rows.push({
        key: projectId,
        group: "unavailable",
        project: {
          id: projectId,
          name: fact.value.name,
          status: "UNKNOWN",
          hq,
        },
      });
    }
    const tints = assignCandidateMateTints(rows);
    return Object.fromEntries(
      rows.map(({ project }) => {
        const membership = readZeropsMembership(project);
        const tint = tints.get(project.id) ?? "slate";
        const overview = hqMateOverview.derive(read, { orgId, projectId: project.id });
        return [
          project.id,
          {
            projectId: project.id,
            environmentId: overview?.identity?.environmentId,
            fullName: project.name,
            name: projectNameInApp(project),
            tint,
            shape: mateShapeOf(project, tint),
            project: membership.label,
            projectUrl: zeropsProjectUrl(project.id),
            ...(membership.standUp === undefined ? {} : { standUp: membership.standUp }),
            ...(membership.madeBy === undefined ? {} : { madeBy: membership.madeBy }),
            ...(overview?.identity?.runsWithoutSignIn === undefined
              ? {}
              : {
                  runsWithoutSignIn: overview.identity.runsWithoutSignIn,
                }),
          } satisfies HqMateIdentity,
        ];
      }),
    );
  },
  equals: sameValue,
};
