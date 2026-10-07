import { admitPlatformOperation } from "./platformAdmission.ts";
import type { ZeropsOrganization } from "../../../zerops/api.ts";
/**
 * Zerops as an operation's owner, over the account's REST client: each Zerops kind's executor,
 * picked by the intent's kind. Zerops keeps no request ids, so a lost answer is resolved by the
 * kind's `effectHandles` over the store's facts, never by asking or sending again.
 *
 * @module data/operations/executors/zerops
 */
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import type { AtomRegistry } from "effect/unstable/reactivity";

import { ZeropsWriteNotSent, type ZeropsApiClient } from "../../../zerops/api.ts";
import type { ThrowawayDebt } from "../../../zerops/doorThrowaway.ts";
import type { HqCoreArtifact } from "../../../zerops/hq/birth.ts";
import {
  makeProjectTagWriter,
  makeInMemoryProjectTagLocks,
  type ProjectTagLocks,
} from "./projectTags.ts";
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
import { readRetiredMateKey, retireMateKeyExecutor } from "./mateDeletion.ts";
import { mateKeyRetirementAllowed } from "../mateDeletion.ts";
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
import { serviceRestartExecutor, vaultWriteExecutor } from "./vaultWrites.ts";

type ZeropsOperationsClient = Pick<
  ZeropsApiClient,
  | "restartService"
  | "stopService"
  | "startService"
  | "deleteProject"
  | "listIntegrationTokens"
  | "readIntegrationToken"
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
  | "addProjectVariable"
  | "updateProjectVariable"
  | "removeProjectVariable"
  | "addServiceVariable"
  | "updateServiceVariable"
  | "removeServiceVariable"
>;

export function makeZeropsExecutor(input: {
  readonly client: ZeropsOperationsClient;
  readonly viewerOf: (orgId: string) => ZeropsOrganization | undefined;
  readonly active: () => boolean;
  readonly readDetail: (demand: DetailDemand) => Promise<boolean>;
  readonly store: AccountStore;
  readonly registry: AtomRegistry.AtomRegistry;
  /** The account's hold on a detail while an operation needs it observed. */
  readonly demandDetail: (demand: DetailDemand) => () => void;
  /** Our successful write invalidates its organization's sampled detail. */
  readonly revalidate: (orgId: string, demand: DetailDemand) => void;
  readonly debtOf: (clientId: string) => ThrowawayDebt;
  readonly nowMs: () => number;
  readonly run: RunToEnd;
  readonly makeId: () => string;
  /** The HQ Core this app carries, which HQ's update deploys. */
  readonly hqCore: () => Promise<HqCoreArtifact>;
  /** The page's locks, which serialize a project's record writes across tabs; absent, this page's. */
  readonly locks?: ProjectTagLocks;
}): OperationExecutor {
  const tagLocks = input.locks ?? makeInMemoryProjectTagLocks();
  const assemble = (client: ZeropsOperationsClient): OperationExecutor => {
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
    const retireKey = retireMateKeyExecutor(client);
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
      variablesWritten: ({ orgId, serviceId }) =>
        input.revalidate(orgId, { family: "mateVariables", ownerId: serviceId }),
      restartService: (serviceId) => client.restartService(serviceId),
    });
    const tags = makeProjectTagWriter({ source: client, locks: tagLocks });
    const rename = renameProjectExecutor(tags);
    const retag = updateProjectTagsExecutor(tags);
    const assign = assignMateOwnerExecutor({
      setProjectMemberRole: (input) => client.setProjectMemberRole(input),
      fetchProject: (projectId) => client.fetchProject(projectId),
    });
    const birthWrite = hqBirthExecutor({
      createProjectEnv: (projectId, key, content) =>
        client.createProjectEnv(projectId, key, content),
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
        run: async (intent, options) => {
          if (intent.kind === "hq-update")
            intent = { ...intent, carried: (await input.hqCore()).build };
          return input.run(intent, options);
        },
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
    const vault = vaultWriteExecutor({
      addProjectVariable: (projectId, write) => client.addProjectVariable(projectId, write),
      updateProjectVariable: (id, write) => client.updateProjectVariable(id, write),
      removeProjectVariable: (id) => client.removeProjectVariable(id),
      addServiceVariable: (serviceId, write) => client.addServiceVariable(serviceId, write),
      updateServiceVariable: (id, write) => client.updateServiceVariable(id, write),
      removeServiceVariable: (id) => client.removeServiceVariable(id),
    });
    const restartOne = serviceRestartExecutor({
      restartService: (serviceId) => client.restartService(serviceId),
    });
    return {
      submit: (requestId, intent) =>
        Effect.suspend(() => {
          switch (intent.kind) {
            case "mate-restart":
              return restart.submit(requestId, intent);
            case "delete-project":
              return remove(requestId, intent);
            case "retire-mate-key":
              return retireKey(requestId, intent);
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
            case "finish-mate-handover":
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
            case "vault-write":
              return vault(requestId, intent);
            case "service-restart":
              return restartOne(requestId, intent);
            default:
              // HQ's own writes go to HQ's executor; the coordinator never routes one here.
              return Effect.die(new Error(`Zerops executes no ${intent.kind}.`));
          }
        }),
    };
  };
  return {
    isCurrent: () => input.active(),
    lookupKinds: new Set(["retire-mate-key"]),
    lookup: (requestId, intent) =>
      Effect.gen(function* () {
        if (
          intent.kind !== "retire-mate-key" ||
          !input.active() ||
          !mateKeyRetirementAllowed(readsOfState(input.store.state()), intent)
        )
          return {
            unobservable: {
              nextActor: "person",
              nextAction: "Return to the original account and deletion receipt",
            },
          };
        const answer = yield* readRetiredMateKey(input.client, requestId, intent);
        return input.active()
          ? answer
          : { unobservable: { nextActor: "person", nextAction: "Return to the original account" } };
      }),
    submit: (requestId, intent) => {
      const admission = () =>
        admitPlatformOperation({
          intent,
          store: input.store,
          viewer:
            intent.kind === "throwaway-sweep"
              ? undefined
              : input.viewerOf("orgId" in intent ? intent.orgId : ""),
          active: input.active,
          readDetail: input.readDetail,
        });
      const check = async () => {
        const answer = await Effect.runPromise(Effect.result(admission()));
        if (Result.isFailure(answer)) throw new ZeropsWriteNotSent(answer.failure);
      };
      const source = input.client;
      const client: ZeropsOperationsClient = {
        restartService: (id, signal) => source.restartService(id, signal, check),
        stopService: (id) => source.stopService(id, check),
        startService: (id) => source.startService(id, check),
        deleteProject: (id, signal) => source.deleteProject(id, signal, check),
        enableSubdomainAccess: (id) => source.enableSubdomainAccess(id, check),
        writeMateFlag: (id) => source.writeMateFlag(id, check),
        startProject: (id) => source.startProject(id, check),
        writeProject: (project, record) => source.writeProject(project, record, check),
        setProjectMemberRole: (input) => source.setProjectMemberRole(input, check),
        createProject: (input, signal) => source.createProject(input, signal, check),
        importProject: (id, yaml, signal) => source.importProject(id, yaml, signal, check),
        importServicesIntoProject: (id, yaml, signal) =>
          source.importServicesIntoProject(id, yaml, signal, check),
        importDevelopmentContainer: (input, signal) =>
          source.importDevelopmentContainer(input, signal, check),
        hardenMate: (orgId, projectId, signal, _before, tokenId) =>
          source.hardenMate(orgId, projectId, signal, check, tokenId),
        createAppVersion: (id, name, signal) => source.createAppVersion(id, name, signal, check),
        uploadAppVersionArchive: (id, archive, signal) =>
          source.uploadAppVersionArchive(id, archive, signal, check),
        buildAndDeployAppVersion: (id, deploy, signal) =>
          source.buildAndDeployAppVersion(id, deploy, signal, check),
        createProjectEnv: (id, key, content) => source.createProjectEnv(id, key, content, check),
        addProjectVariable: (id, write) => source.addProjectVariable(id, write, check),
        updateProjectVariable: (id, write) => source.updateProjectVariable(id, write, check),
        removeProjectVariable: (id) => source.removeProjectVariable(id, check),
        addServiceVariable: (id, write) => source.addServiceVariable(id, write, check),
        updateServiceVariable: (id, write) => source.updateServiceVariable(id, write, check),
        removeServiceVariable: (id) => source.removeServiceVariable(id, check),
        mintIntegrationToken: (input, signal) => source.mintIntegrationToken(input, signal, check),
        regenerateIntegrationToken: (token, signal) =>
          source.regenerateIntegrationToken(token, signal, check),
        writeServiceSecret: (input, signal) => source.writeServiceSecret(input, signal, check),
        createPublicHttpRouting: (id, routing, signal) =>
          source.createPublicHttpRouting(id, routing, signal, check),
        syncPublicHttpRouting: (id, signal) => source.syncPublicHttpRouting(id, signal, check),
        deleteIntegrationToken: (target, signal) =>
          source.deleteIntegrationToken(target, signal, check),
        listIntegrationTokens: (...args) => source.listIntegrationTokens(...args),
        readIntegrationToken: (...args) => source.readIntegrationToken(...args),
        fetchProject: (...args) => source.fetchProject(...args),
        listClientProjects: (...args) => source.listClientProjects(...args),
        readProjectEnv: (...args) => source.readProjectEnv(...args),
        readProjectBirthEnv: (...args) => source.readProjectBirthEnv(...args),
        listProjectServices: (...args) => source.listProjectServices(...args),
        hasServiceVariable: (...args) => source.hasServiceVariable(...args),
        listPublicHttpRoutings: (...args) => source.listPublicHttpRoutings(...args),
        listOrganizationMembers: (...args) => source.listOrganizationMembers(...args),
      };
      return admission().pipe(Effect.andThen(assemble(client).submit(requestId, intent)));
    },
  };
}
