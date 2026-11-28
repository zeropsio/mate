import { admitPlatformOperation } from "./platformAdmission.ts";
import type { ZeropsOrganization } from "../../../zerops/api/account.ts";
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
import { restartService, deleteService, cancelBuild } from "../../../zerops/api/service.ts";
import { startProject } from "../../../zerops/api/project.ts";
import type { DetailDemand } from "../../demand.ts";
import { readsOfState, type AccountStore } from "../../store.ts";
import { historyScope } from "../../families/process.ts";
import { effectProcessOf } from "../../projections/lostAnswer.ts";
import type { StreamFault } from "../../streamMachine.ts";
import type { OperationExecutor } from "../coordinator.ts";
import { mateRestartOwner } from "./mateRestart.ts";
import { startProjectExecutor } from "./projectWrites.ts";
import { deleteServiceExecutor, enableSubdomainAccessExecutor } from "./serviceWrites.ts";
import { cancelBuildExecutor } from "./pipelineWrites.ts";
import { addressWritesExecutor, type AddressPlatform } from "./addressWrites.ts";
import { serviceRestartExecutor, vaultWriteExecutor, type VaultPlatform } from "./vaultWrites.ts";

/** A service's and a project's lifecycle calls as the admitted client takes them. */
type ServiceLifecycle = {
  readonly restartService: (
    serviceId: string,
  ) => Promise<{ readonly processId: string | undefined }>;
  readonly deleteService: (
    serviceId: string,
  ) => Promise<{ readonly processId: string | undefined }>;
  readonly cancelBuild: (appVersionId: string) => Promise<void>;
  readonly startProject: (projectId: string) => Promise<void>;
};

export function makeZeropsExecutor(input: {
  readonly client: Pick<ZeropsApiClient, "door">;
  readonly viewerOf: (orgId: string) => ZeropsOrganization | undefined;
  readonly active: () => boolean;
  readonly readDetail: (demand: DetailDemand) => Promise<boolean>;
  readonly store: AccountStore;
  /** The account's hold on a detail while an operation needs it observed. */
  readonly demandDetail: (demand: DetailDemand) => () => void;
  /** Our successful write invalidates its organization's sampled detail. */
  readonly revalidate: (orgId: string, demand: DetailDemand) => void;
}): OperationExecutor {
  type AdmittedClient = VaultPlatform &
    AddressPlatform &
    Parameters<typeof enableSubdomainAccessExecutor>[0] &
    ServiceLifecycle;
  const assemble = (client: AdmittedClient): OperationExecutor => {
    const restart = mateRestartOwner({
      restartService: (serviceId) => client.restartService(serviceId),
    });
    const publish = enableSubdomainAccessExecutor({
      enableSubdomainAccess: (serviceId) => client.enableSubdomainAccess(serviceId),
    });
    const cancel = cancelBuildExecutor({
      cancelBuild: (appVersionId) => client.cancelBuild(appVersionId),
    });
    const deleteOne = deleteServiceExecutor({
      deleteService: (serviceId) => client.deleteService(serviceId),
    });
    const startAll = startProjectExecutor({
      startProject: (projectId) => client.startProject(projectId),
    });
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
    return {
      submit: (requestId, intent) =>
        Effect.suspend((): ReturnType<OperationExecutor["submit"]> => {
          switch (intent.kind) {
            case "mate-restart":
              return restart.submit(requestId, intent);
            case "enable-subdomain-access":
              return publish(requestId, intent);
            case "cancel-build":
              return cancel(requestId, intent);
            case "delete-service":
              return deleteOne(requestId, intent);
            case "start-project":
              return startAll(requestId, intent);
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
        restartService: (id) => restartService(source.door, id, undefined, check),
        cancelBuild: (id) => cancelBuild(source.door, id, check),
        deleteService: (id) => deleteService(source.door, id, check),
        enableSubdomainAccess: (id) => enableSubdomainAccess(source.door, id, check),
        startProject: (id) => startProject(source.door, id, check),
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
      };
      return admission().pipe(
        Effect.mapError((fault) => ({ ...fault, writeNotSent: true as const })),
        Effect.andThen(assemble(client).submit(requestId, intent)),
      );
    },
  };
}
