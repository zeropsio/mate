/**
 * Zerops as an operation's owner, over the account's REST client: each Zerops kind's executor,
 * picked by the intent's kind. Zerops keeps no request ids, so a lost answer is resolved by the
 * kind's `effectHandles` over the store's facts, never by asking or sending again.
 *
 * @module data/operations/executors/zerops
 */
import * as Effect from "effect/Effect";
import type { AtomRegistry } from "effect/unstable/reactivity";

import type { ZeropsApiClient } from "../../../zerops/api.ts";
import type { ThrowawayDebt } from "../../../zerops/doorThrowaway.ts";
import type { HqCoreArtifact } from "../../../zerops/hq/birth.ts";
import { makeProjectTagWriter, type ProjectTagLocks } from "../../../zerops/data/tagWriter.ts";
import type { DetailDemand } from "../../demand.ts";
import { readsOfState, type AccountStore } from "../../store.ts";
import { projectsScope } from "../../families/project.ts";
import { hqBirthWaits } from "../../hqBirthWaits.ts";
import type { RunToEnd } from "../runToEnd.ts";
import { hqProvisionExecutor } from "./hqProvision.ts";
import { hqBirthReads } from "./hqBirthReads.ts";
import type { OperationExecutor } from "../coordinator.ts";
import { createProjectExecutor } from "./createProject.ts";
import { deleteProjectExecutor } from "./deleteProject.ts";
import { hqBirthExecutor } from "./hqBirth.ts";
import { hqUpdateExecutor } from "./hqUpdate.ts";
import { creationWritesExecutor } from "./creationWrites.ts";
import { mateRestartOwner } from "./mateRestart.ts";
import {
  assignMateOwnerExecutor,
  renameProjectExecutor,
  startProjectExecutor,
  updateProjectTagsExecutor,
} from "./projectWrites.ts";
import {
  enableSubdomainAccessExecutor,
  enableZeropsMateExecutor,
  startServiceExecutor,
} from "./serviceWrites.ts";
import { throwawaySweepExecutor } from "./throwawaySweep.ts";

type ZeropsOperationsClient = Pick<
  ZeropsApiClient,
  | "restartService"
  | "stopService"
  | "startService"
  | "deleteProject"
  | "listIntegrationTokens"
  | "deleteIntegrationToken"
  | "enableSubdomainAccess"
  | "writeMateFlag"
  | "startProject"
  | "fetchProject"
  | "writeProject"
  | "setProjectMemberRole"
  | "createProject"
  | "listClientProjects"
  | "importProject"
  | "importServicesIntoProject"
  | "importDevelopmentContainer"
  | "hardenMate"
  | "readProjectEnv"
  | "readProjectBirthEnv"
  | "listProjectServices"
  | "createAppVersion"
  | "uploadAppVersionArchive"
  | "buildAndDeployAppVersion"
  | "createProjectEnv"
  | "hasServiceVariable"
  | "mintIntegrationToken"
  | "regenerateIntegrationToken"
  | "writeServiceSecret"
  | "listPublicHttpRoutings"
  | "createPublicHttpRouting"
  | "syncPublicHttpRouting"
  | "listOrganizationMembers"
>;

export function makeZeropsExecutor(input: {
  readonly client: ZeropsOperationsClient;
  readonly store: AccountStore;
  readonly registry: AtomRegistry.AtomRegistry;
  /** The account's hold on a detail while an operation needs it observed. */
  readonly demandDetail: (demand: DetailDemand) => () => void;
  readonly debtOf: (clientId: string) => ThrowawayDebt;
  readonly nowMs: () => number;
  readonly run: RunToEnd;
  readonly makeId: () => string;
  /** The HQ Core this app carries, which HQ's update deploys. */
  readonly hqCore: () => Promise<HqCoreArtifact>;
  /** The page's locks, which serialize a project's record writes across tabs; absent, this page's. */
  readonly locks?: ProjectTagLocks;
}): OperationExecutor {
  const { client } = input;
  const restart = mateRestartOwner({
    platform: {
      restartService: (serviceId) => client.restartService(serviceId),
      stopService: (serviceId) => client.stopService(serviceId),
      startService: (serviceId) => client.startService(serviceId),
    },
    store: input.store,
    registry: input.registry,
    holdHistory: (projectId) =>
      input.demandDetail({ family: "process", listing: "history", ownerId: projectId }),
  });
  const remove = deleteProjectExecutor({
    deleteProject: (projectId) => client.deleteProject(projectId),
  });
  const create = createProjectExecutor({
    createProject: (input) => client.createProject(input),
    listClientProjects: (clientId) => client.listClientProjects(clientId),
    listed: (orgId, name) => {
      const read = readsOfState(input.store.state());
      const projects = read.members(projectsScope(orgId));
      if (projects.coverage !== "complete") return null;
      return projects.ids.filter((id) => {
        const project = read.fact("project", id);
        return project.kind === "known" && project.value.name === name;
      });
    },
  });
  const creationWrite = creationWritesExecutor({
    importProject: (clientId, yaml) => client.importProject(clientId, yaml),
    importServicesIntoProject: (projectId, yaml) =>
      client.importServicesIntoProject(projectId, yaml),
    importDevelopmentContainer: (input) => client.importDevelopmentContainer(input),
    hardenMate: (clientId, projectId, keyTokenId) =>
      client.hardenMate(clientId, projectId, undefined, undefined, keyTokenId),
    readProjectEnv: (clientId, projectId) => client.readProjectEnv(clientId, projectId),
  });
  const updateHq = hqUpdateExecutor({
    core: input.hqCore,
    createAppVersion: (serviceId, name) => client.createAppVersion(serviceId, name),
    uploadAppVersionArchive: (id, archive) => client.uploadAppVersionArchive(id, archive),
    buildAndDeployAppVersion: (id, deploy) => client.buildAndDeployAppVersion(id, deploy),
  });
  const sweep = throwawaySweepExecutor({
    platform: {
      listIntegrationTokens: async (clientId) =>
        (await client.listIntegrationTokens(clientId)).map((token) => ({
          id: token.id,
          name: token.name,
          created: token.created,
          createdByUser: token.createdByUser,
        })),
      deleteIntegrationToken: (target) => client.deleteIntegrationToken(target),
    },
    debtOf: input.debtOf,
    nowMs: input.nowMs,
  });
  const publish = enableSubdomainAccessExecutor({
    enableSubdomainAccess: (serviceId) => client.enableSubdomainAccess(serviceId),
  });
  const startOne = startServiceExecutor({
    startService: (serviceId) => client.startService(serviceId),
  });
  const startAll = startProjectExecutor({
    startProject: (projectId) => client.startProject(projectId),
  });
  const enableMate = enableZeropsMateExecutor({
    writeMateFlag: (serviceId) => client.writeMateFlag(serviceId),
    restartService: (serviceId) => client.restartService(serviceId),
  });
  const tags = makeProjectTagWriter({ source: client, locks: input.locks });
  const rename = renameProjectExecutor(tags);
  const retag = updateProjectTagsExecutor(tags);
  const assign = assignMateOwnerExecutor({
    setProjectMemberRole: (input) => client.setProjectMemberRole(input),
    fetchProject: (projectId) => client.fetchProject(projectId),
  });
  const birthWrite = hqBirthExecutor({
    createProjectEnv: (projectId, key, content) => client.createProjectEnv(projectId, key, content),
    hasServiceVariable: (input) => client.hasServiceVariable(input),
    listIntegrationTokens: (clientId) => client.listIntegrationTokens(clientId),
    mintIntegrationToken: (input) => client.mintIntegrationToken(input),
    regenerateIntegrationToken: (input) => client.regenerateIntegrationToken(input),
    writeServiceSecret: (input) => client.writeServiceSecret(input),
    listPublicHttpRoutings: (projectId) => client.listPublicHttpRoutings(projectId),
    createPublicHttpRouting: (projectId, routing) =>
      client.createPublicHttpRouting(projectId, routing),
    syncPublicHttpRouting: (projectId) => client.syncPublicHttpRouting(projectId),
    listOrganizationMembers: (clientId) => client.listOrganizationMembers(clientId),
  });
  const provisionHq = hqProvisionExecutor({
    store: input.store,
    deps: {
      run: input.run,
      reads: hqBirthReads(client),
      waits: hqBirthWaits({
        data: input.store.data,
        registry: input.registry,
        demandDetail: input.demandDetail,
      }),
      now: input.nowMs,
      newBirthId: input.makeId,
    },
  });
  return {
    submit: (requestId, intent) => {
      switch (intent.kind) {
        case "mate-restart":
          return restart.submit(requestId, intent);
        case "delete-project":
          return remove(requestId, intent);
        case "throwaway-sweep":
          return sweep(requestId, intent);
        case "enable-subdomain-access":
          return publish(requestId, intent);
        case "start-service":
          return startOne(requestId, intent);
        case "start-project":
          return startAll(requestId, intent);
        case "enable-zerops-mate":
          return enableMate(requestId, intent);
        case "rename-project":
          return rename(requestId, intent);
        case "update-project-tags":
          return retag(requestId, intent);
        case "assign-mate-owner":
          return assign(requestId, intent);
        case "hq-birth":
          return provisionHq(requestId, intent);
        case "hq-update":
          return updateHq(requestId, intent);
        case "create-project":
          return create(requestId, intent);
        case "import-project":
        case "import-services":
        case "import-container":
        case "harden-project":
          return creationWrite(requestId, intent);
        case "hq-birth-note":
        case "hq-org-token":
        case "hq-key-secret":
        case "route-hq-domain":
        case "mark-official-hq":
          return birthWrite(requestId, intent);
        default:
          // HQ's own writes go to HQ's executor; the coordinator never routes one here.
          return Effect.die(new Error(`Zerops executes no ${intent.kind}.`));
      }
    },
  };
}
