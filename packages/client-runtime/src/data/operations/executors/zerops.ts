import { admitPlatformOperation } from "./platformAdmission.ts";
import {
  validateOrganizationUser,
  listOrganizationMembers,
  type ZeropsOrganization,
} from "../../../zerops/api/account.ts";
/**
 * Zerops as an operation's owner, over the account's REST client: each Zerops kind's executor,
 * picked by the intent's kind. Zerops keeps no request ids, so a lost answer is resolved by the
 * kind's `effectHandles` over the store's facts — for a write whose effect is one process on one
 * service (`effectProcessOf`), over its project's process history read afresh (`holdEffects`) —
 * and never by sending again.
 *
 * @module data/operations/executors/zerops
 */
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { ZeropsWriteNotSent } from "../../../zerops/errors.ts";
import type { ZeropsApiClient } from "../../../zerops/api.ts";
import {
  addProjectVariable,
  updateProjectVariable,
  removeProjectVariable,
  addServiceVariable,
  updateServiceVariable,
  removeServiceVariable,
} from "../../../zerops/api/variables.ts";
import {
  createPublicHttpRouting,
  updatePublicHttpRouting,
  deletePublicHttpRouting,
  checkPublicHttpRoutingDns,
  createPublicPortRouting,
  updatePublicPortRouting,
  deletePublicPortRouting,
  requestProjectPublicIp,
  disableSubdomainAccess,
  enableSubdomainAccess,
} from "../../../zerops/api/routing.ts";
import {
  restartService,
  stopService,
  deleteService,
  startService,
  cancelBuild,
} from "../../../zerops/api/service.ts";
import {
  startProject,
  stopProject,
  importServicesIntoProject,
} from "../../../zerops/api/project.ts";
import {
  makeProjectTagWriter,
  makeInMemoryProjectTagLocks,
  type ProjectTagLocks,
} from "./projectTags.ts";
import type { DetailDemand } from "../../demand.ts";
import { readsOfState, type AccountStore } from "../../store.ts";
import { historyScope } from "../../families/process.ts";
import { effectProcessOf } from "../../projections/lostAnswer.ts";
import type { StreamFault } from "../../streamMachine.ts";
import type { OperationExecutor } from "../coordinator.ts";
import { createServicesExecutor } from "./creationWrites.ts";
import { mateDeployExecutor } from "./mateDeploy.ts";
import { mateRestartOwner } from "./mateRestart.ts";
import {
  projectLifecycleExecutor,
  renameProjectExecutor,
  updateProjectTagsExecutor,
} from "./projectWrites.ts";
import {
  deleteServiceExecutor,
  enableSubdomainAccessExecutor,
  startServiceExecutor,
  stopServiceExecutor,
} from "./serviceWrites.ts";
import { cancelBuildExecutor } from "./pipelineWrites.ts";
import { addressWritesExecutor, type AddressPlatform } from "./addressWrites.ts";
import { appAccessExecutor, type AppAccessPlatform } from "./appAccess.ts";
import { serviceRestartExecutor, vaultWriteExecutor, type VaultPlatform } from "./vaultWrites.ts";

type ZeropsOperationsClient = Pick<
  ZeropsApiClient,
  "deployMate" | "fetchProject" | "writeProject" | "listProjectServices" | "door"
>;

/** A service's and a project's lifecycle calls as the admitted client takes them. */
type ServiceLifecycle = {
  readonly restartService: (
    serviceId: string,
  ) => Promise<{ readonly processId: string | undefined }>;
  readonly stopService: (serviceId: string) => Promise<{ readonly processId: string | undefined }>;
  readonly startService: (serviceId: string) => Promise<{ readonly processId: string | undefined }>;
  readonly deleteService: (
    serviceId: string,
  ) => Promise<{ readonly processId: string | undefined }>;
  readonly cancelBuild: (appVersionId: string) => Promise<void>;
  readonly startProject: (projectId: string) => Promise<void>;
  readonly stopProject: (projectId: string) => Promise<void>;
};

export function makeZeropsExecutor(input: {
  readonly client: ZeropsOperationsClient;
  readonly viewerOf: (orgId: string) => ZeropsOrganization | undefined;
  readonly active: () => boolean;
  readonly readDetail: (demand: DetailDemand) => Promise<boolean>;
  readonly store: AccountStore;
  /** The account's hold on a detail while an operation needs it observed. */
  readonly demandDetail: (demand: DetailDemand) => () => void;
  /** Our successful write invalidates its organization's sampled detail. */
  readonly revalidate: (orgId: string, demand: DetailDemand) => void;
  readonly nowMs: () => number;
  /** The page's locks, which serialize a project's record writes across tabs; absent, this page's. */
  readonly locks?: ProjectTagLocks;
}): OperationExecutor {
  const tagLocks = input.locks ?? makeInMemoryProjectTagLocks();
  type AdmittedClient = Omit<ZeropsOperationsClient, "door"> &
    VaultPlatform &
    AddressPlatform &
    Parameters<typeof enableSubdomainAccessExecutor>[0] &
    ServiceLifecycle &
    AppAccessPlatform &
    Pick<Parameters<typeof createServicesExecutor>[0], "importServicesIntoProject">;
  const assemble = (client: AdmittedClient): OperationExecutor => {
    const deploy = mateDeployExecutor({ deployMate: (serviceId) => client.deployMate(serviceId) });
    const restart = mateRestartOwner({
      restartService: (serviceId) => client.restartService(serviceId),
    });
    const createMissing = createServicesExecutor({
      importServicesIntoProject: (projectId, yaml) =>
        client.importServicesIntoProject(projectId, yaml),
      nowMs: input.nowMs,
    });
    const publish = enableSubdomainAccessExecutor({
      enableSubdomainAccess: (serviceId) => client.enableSubdomainAccess(serviceId),
    });
    const startOne = startServiceExecutor({
      startService: (serviceId) => client.startService(serviceId),
    });
    const cancel = cancelBuildExecutor({
      cancelBuild: (appVersionId) => client.cancelBuild(appVersionId),
    });
    const stopOne = stopServiceExecutor({
      stopService: (serviceId) => client.stopService(serviceId),
    });
    const deleteOne = deleteServiceExecutor({
      deleteService: (serviceId) => client.deleteService(serviceId),
    });
    const startAll = projectLifecycleExecutor((projectId) => client.startProject(projectId));
    const stopAll = projectLifecycleExecutor((projectId) => client.stopProject(projectId));
    const tags = makeProjectTagWriter({ source: client, locks: tagLocks });
    const rename = renameProjectExecutor(tags);
    const retag = updateProjectTagsExecutor(tags);
    const vault = vaultWriteExecutor(client);
    const restartOne = serviceRestartExecutor({
      restartService: (serviceId) => client.restartService(serviceId),
    });
    const addresses = addressWritesExecutor({
      createPublicHttpRouting: (projectId, routing) =>
        client.createPublicHttpRouting(projectId, routing),
      updatePublicHttpRouting: (id, routing) => client.updatePublicHttpRouting(id, routing),
      deletePublicHttpRouting: (id) => client.deletePublicHttpRouting(id),
      checkPublicHttpRoutingDns: (id) => client.checkPublicHttpRoutingDns(id),
      disableSubdomainAccess: (serviceId) => client.disableSubdomainAccess(serviceId),
      createPublicPortRouting: (serviceId, port) => client.createPublicPortRouting(serviceId, port),
      updatePublicPortRouting: (id, port) => client.updatePublicPortRouting(id, port),
      deletePublicPortRouting: (id) => client.deletePublicPortRouting(id),
      requestProjectPublicIp: (projectId) => client.requestProjectPublicIp(projectId),
    });
    const people = appAccessExecutor({
      validateOrganizationUser: (orgId, email) => client.validateOrganizationUser(orgId, email),
      listOrganizationMembers: (orgId) => client.listOrganizationMembers(orgId),
    });
    return {
      submit: (requestId, intent) =>
        Effect.suspend((): ReturnType<OperationExecutor["submit"]> => {
          switch (intent.kind) {
            case "mate-deploy":
              return deploy(requestId, intent);
            case "mate-restart":
              return restart.submit(requestId, intent);
            case "enable-subdomain-access":
              return publish(requestId, intent);
            case "start-service":
              return startOne(requestId, intent);
            case "stop-service":
              return stopOne(requestId, intent);
            case "cancel-build":
              return cancel(requestId, intent);
            case "delete-service":
              return deleteOne(requestId, intent);
            case "start-project":
              return startAll(requestId, intent);
            case "stop-project":
              return stopAll(requestId, intent);
            case "rename-project":
              return rename(requestId, intent);
            case "update-project-tags":
              return retag(requestId, intent);
            case "create-services":
              return createMissing(requestId, intent);
            case "vault-write":
              return vault(requestId, intent);
            case "service-restart":
              return restartOne(requestId, intent);
            case "add-domain":
              return addresses.addDomain(requestId, intent);
            case "remove-domain":
              return addresses.removeDomain(requestId, intent);
            case "check-domain-dns":
              return addresses.checkDomainDns(requestId, intent);
            case "disable-subdomain-access":
              return addresses.disableSubdomainAccess(requestId, intent);
            case "open-port":
              return addresses.openPort(requestId, intent);
            case "change-port":
              return addresses.changePort(requestId, intent);
            case "close-port":
              return addresses.closePort(requestId, intent);
            case "request-ipv4":
              return addresses.requestIpv4(requestId, intent);
            case "check-invitee":
              return people.check(requestId, intent);
            default:
              // HQ's own writes go to HQ's executor; the coordinator never routes one here.
              return Effect.die(new Error(`Zerops executes no ${intent.kind}.`));
          }
        }),
    };
  };
  return {
    isCurrent: () => input.active(),
    // A write whose effect is one process on one service is judged on its project's process
    // history read afresh: the one reader of Zerops processes is that detail, asked to be read
    // again and awaited.
    holdEffects: (intent) => {
      const effect = effectProcessOf(intent);
      if (effect === null) return null;
      const demand = { family: "process", listing: "history", ownerId: effect.projectId } as const;
      return Effect.tryPromise({
        try: async () => {
          const release = input.demandDetail(demand);
          try {
            input.revalidate(effect.orgId, demand);
            const read = await input.readDetail(demand);
            if (
              !read ||
              !input.active() ||
              readsOfState(input.store.state()).coverage(
                historyScope(effect.orgId, effect.projectId),
              ) !== "complete"
            )
              throw new Error("The project's processes could not be read.");
            return { release, absent: effect.absent };
          } catch (cause) {
            release();
            throw cause;
          }
        },
        catch: (): StreamFault => ({
          outcome: "transient",
          message: "Zerops could not be asked.",
        }),
      });
    },
    submit: (requestId, intent) => {
      const admission = () =>
        admitPlatformOperation({
          intent,
          store: input.store,
          viewer: input.viewerOf("orgId" in intent ? intent.orgId : ""),
          active: input.active,
          readDetail: input.readDetail,
        });
      const check = async () => {
        const answer = await Effect.runPromise(Effect.result(admission()));
        if (Result.isFailure(answer)) throw new ZeropsWriteNotSent(answer.failure);
      };
      const source = input.client;
      const client: AdmittedClient = {
        deployMate: (id, signal) => source.deployMate(id, signal, check),
        restartService: (id) => restartService(source.door, id, undefined, check),
        stopService: (id) => stopService(source.door, id, check),
        cancelBuild: (id) => cancelBuild(source.door, id, check),
        startService: (id) => startService(source.door, id, check),
        deleteService: (id) => deleteService(source.door, id, check),
        enableSubdomainAccess: (id) => enableSubdomainAccess(source.door, id, check),
        startProject: (id) => startProject(source.door, id, check),
        stopProject: (id) => stopProject(source.door, id, check),
        writeProject: (project, record) => source.writeProject(project, record, check),
        importServicesIntoProject: (id, yaml) =>
          importServicesIntoProject(source.door, id, yaml, undefined, check),
        addProjectVariable: (id, write) => addProjectVariable(source.door, id, write, check),
        updateProjectVariable: (id, write) => updateProjectVariable(source.door, id, write, check),
        removeProjectVariable: (id) => removeProjectVariable(source.door, id, check),
        addServiceVariable: (id, write) => addServiceVariable(source.door, id, write, check),
        updateServiceVariable: (id, write) => updateServiceVariable(source.door, id, write, check),
        removeServiceVariable: (id) => removeServiceVariable(source.door, id, check),
        createPublicHttpRouting: (id, routing) =>
          createPublicHttpRouting(source.door, id, routing, undefined, check),
        updatePublicHttpRouting: (id, routing) =>
          updatePublicHttpRouting(source.door, id, routing, undefined, check),
        deletePublicHttpRouting: (id) => deletePublicHttpRouting(source.door, id, undefined, check),
        checkPublicHttpRoutingDns: (id) =>
          checkPublicHttpRoutingDns(source.door, id, undefined, check),
        disableSubdomainAccess: (id) => disableSubdomainAccess(source.door, id, check),
        createPublicPortRouting: (id, port) =>
          createPublicPortRouting(source.door, id, port, undefined, check),
        updatePublicPortRouting: (id, port) =>
          updatePublicPortRouting(source.door, id, port, undefined, check),
        deletePublicPortRouting: (id) => deletePublicPortRouting(source.door, id, undefined, check),
        requestProjectPublicIp: (id) => requestProjectPublicIp(source.door, id, undefined, check),
        fetchProject: (...args) => source.fetchProject(...args),
        listProjectServices: (...args) => source.listProjectServices(...args),
        listOrganizationMembers: (orgId) => listOrganizationMembers(source.door, orgId),
        validateOrganizationUser: (orgId, email) =>
          validateOrganizationUser(source.door, orgId, email, check),
      };
      return admission().pipe(
        Effect.mapError((fault) => ({ ...fault, writeNotSent: true as const })),
        Effect.andThen(assemble(client).submit(requestId, intent)),
      );
    },
  };
}
