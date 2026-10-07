/** Service facts used by the flow's behaviour tests. */
import { project } from "../../data/__fixtures__/index.ts";
import type { ProjectRef } from "../../data/types.ts";
import type { ServiceValue } from "../../../data/families/service.ts";
import type { DeploymentServices, ServiceDeployInfo } from "../deployment.ts";

export const deployed = (deploy: ServiceDeployInfo | null) => deploy;
export const UNRESOLVED_DEPLOYMENT = undefined;
export function record(
  id: string,
  name: string,
  deploy: ServiceDeployInfo | null | undefined,
  options: {
    readonly isSystem?: boolean;
    readonly type?: string;
    readonly project?: ProjectRef;
  } = {},
): ServiceValue {
  return {
    id,
    name,
    projectId: (options.project ?? project()).projectId,
    status: "ACTIVE",
    isSystem: options.isSystem ?? false,
    serviceStackTypeInfo: { serviceStackTypeVersionName: options.type ?? "nodejs@22" },
    ...(deploy === undefined
      ? {}
      : {
          activeAppVersion:
            deploy === null
              ? null
              : {
                  ...(deploy.id === null ? {} : { id: deploy.id }),
                  ...(deploy.status === null ? {} : { status: deploy.status }),
                  ...(deploy.source === null ? {} : { source: deploy.source }),
                  ...(deploy.name === null ? {} : { name: deploy.name }),
                  ...(deploy.activatedAt === null ? {} : { lastUpdate: deploy.activatedAt }),
                  githubIntegration: {
                    branchName: deploy.branch,
                    commit: deploy.commit,
                    tagName: deploy.tag,
                    repositoryFullName: deploy.repository,
                  },
                },
        }),
  };
}
export function servicesRead(
  records: ReadonlyArray<ServiceValue | "unresolved">,
  options: {
    readonly complete?: boolean;
    readonly live?: boolean;
    readonly reconnecting?: boolean;
    readonly unavailableReason?: DeploymentServices["unavailableReason"];
    readonly project?: ProjectRef;
  } = {},
): DeploymentServices {
  return {
    project: options.project ?? project(),
    services:
      options.complete === false || records.includes("unresolved")
        ? undefined
        : records.filter((entry): entry is ServiceValue => entry !== "unresolved"),
    live: options.live ?? true,
    reconnecting: options.reconnecting ?? false,
    ...(options.unavailableReason === undefined
      ? {}
      : { unavailableReason: options.unavailableReason }),
  };
}
