import { admitPlatformOperation } from "./platformAdmission.ts";
import { commitOwn } from "../../adapters/hqSettingsReads.ts";
import { observeCredentialId, observeRequestScope } from "../../families/hqObserveCredential.ts";
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
import type { AtomRegistry } from "effect/reactivity";

import { ZeropsWriteNotSent, type ZeropsApiClient } from "../../../zerops/api.ts";
import { HqError, type HqApi } from "../../../zerops/hq/client.ts";
import {
  makeProjectTagWriter,
  makeInMemoryProjectTagLocks,
  type ProjectTagLocks,
} from "./projectTags.ts";
import type { DetailDemand } from "../../demand.ts";
import { readsOfState, type AccountStore } from "../../store.ts";
import { projectsScope } from "../../families/project.ts";
import type { RunToEnd } from "../runToEnd.ts";
import type { OperationExecutor } from "../coordinator.ts";
import { createProjectExecutor } from "./createProject.ts";
import { deleteProjectExecutor } from "./deleteProject.ts";
import { readRetiredMateKey, retireMateKeyExecutor } from "./mateDeletion.ts";
import { mateKeyRetirementAllowed } from "../mateDeletion.ts";
import { creationWritesExecutor } from "./creationWrites.ts";
import { mateDeployExecutor } from "./mateDeploy.ts";
import { mateRestartOwner } from "./mateRestart.ts";
import {
  assignMateOwnerExecutor,
  renameProjectExecutor,
  startProjectExecutor,
  updateProjectTagsExecutor,
} from "./projectWrites.ts";
import {
  deleteServiceExecutor,
  enableSubdomainAccessExecutor,
  enableZeropsMateExecutor,
  startServiceExecutor,
  stopServiceExecutor,
} from "./serviceWrites.ts";
import { addressWritesExecutor } from "./addressWrites.ts";
import { appAccessExecutor } from "./appAccess.ts";
import { teamExecutor } from "./team.ts";
import { serviceRestartExecutor, vaultWriteExecutor } from "./vaultWrites.ts";

type ZeropsOperationsClient = Pick<
  ZeropsApiClient,
  | "deployMate"
  | "restartService"
  | "stopService"
  | "startService"
  | "deleteService"
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
  | "listProjectServices"
  | "mintIntegrationToken"
  | "regenerateIntegrationToken"
  | "createPublicHttpRouting"
  | "syncPublicHttpRouting"
  | "updatePublicHttpRouting"
  | "deletePublicHttpRouting"
  | "checkPublicHttpRoutingDns"
  | "disableSubdomainAccess"
  | "createPublicPortRouting"
  | "updatePublicPortRouting"
  | "deletePublicPortRouting"
  | "syncPublicPortRouting"
  | "requestProjectPublicIp"
  | "listOrganizationMembers"
  | "addProjectVariable"
  | "updateProjectVariable"
  | "removeProjectVariable"
  | "addServiceVariable"
  | "updateServiceVariable"
  | "removeServiceVariable"
  | "validateOrganizationUser"
  | "inviteOrganizationUser"
  | "connectOrganizationUser"
  | "readMemberProjectRoles"
  | "writeMemberProjectRoles"
  | "writeNewProjectAccess"
  | "removeOrganizationMember"
  | "updateOrganizationMember"
>;

export function makeZeropsExecutor(input: {
  readonly client: ZeropsOperationsClient & Pick<ZeropsApiClient, "accountEpoch">;
  /** Capture this operation's HQ/person before native credential establishment can yield. */
  readonly hqApiOf: (orgId: string) => Pick<HqApi, "establishZcpAuthorization"> | null;
  readonly viewerOf: (orgId: string) => ZeropsOrganization | undefined;
  readonly active: () => boolean;
  readonly readDetail: (demand: DetailDemand) => Promise<boolean>;
  readonly store: AccountStore;
  readonly registry: AtomRegistry.AtomRegistry;
  /** The account's hold on a detail while an operation needs it observed. */
  readonly demandDetail: (demand: DetailDemand) => () => void;
  /** Our successful write invalidates its organization's sampled detail. */
  readonly revalidate: (orgId: string, demand: DetailDemand) => void;
  readonly nowMs: () => number;
  readonly run: RunToEnd;
  readonly makeId: () => string;
  /** The page's locks, which serialize a project's record writes across tabs; absent, this page's. */
  readonly locks?: ProjectTagLocks;
}): OperationExecutor {
  const tagLocks = input.locks ?? makeInMemoryProjectTagLocks();
  const assemble = (client: ZeropsOperationsClient): OperationExecutor => {
    const deploy = mateDeployExecutor({ deployMate: (serviceId) => client.deployMate(serviceId) });
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
    const publish = enableSubdomainAccessExecutor({
      enableSubdomainAccess: (serviceId) => client.enableSubdomainAccess(serviceId),
    });
    const startOne = startServiceExecutor({
      startService: (serviceId) => client.startService(serviceId),
    });
    const stopOne = stopServiceExecutor({
      stopService: (serviceId) => client.stopService(serviceId),
    });
    const deleteOne = deleteServiceExecutor({
      deleteService: (serviceId) => client.deleteService(serviceId),
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
    const addresses = addressWritesExecutor({
      createPublicHttpRouting: (projectId, routing) =>
        client.createPublicHttpRouting(projectId, routing),
      updatePublicHttpRouting: (id, routing) => client.updatePublicHttpRouting(id, routing),
      deletePublicHttpRouting: (id) => client.deletePublicHttpRouting(id),
      checkPublicHttpRoutingDns: (id) => client.checkPublicHttpRoutingDns(id),
      syncPublicHttpRouting: (projectId) => client.syncPublicHttpRouting(projectId),
      disableSubdomainAccess: (serviceId) => client.disableSubdomainAccess(serviceId),
      createPublicPortRouting: (serviceId, port) => client.createPublicPortRouting(serviceId, port),
      updatePublicPortRouting: (id, port) => client.updatePublicPortRouting(id, port),
      deletePublicPortRouting: (id) => client.deletePublicPortRouting(id),
      syncPublicPortRouting: (projectId) => client.syncPublicPortRouting(projectId),
      requestProjectPublicIp: (projectId) => client.requestProjectPublicIp(projectId),
    });
    const people = appAccessExecutor(
      {
        validateOrganizationUser: (orgId, email) => client.validateOrganizationUser(orgId, email),
        inviteOrganizationUser: (orgId, invite) => client.inviteOrganizationUser(orgId, invite),
        connectOrganizationUser: (orgId, invite) => client.connectOrganizationUser(orgId, invite),
        listOrganizationMembers: (orgId) => client.listOrganizationMembers(orgId),
        readMemberProjectRoles: (id) => client.readMemberProjectRoles(id),
        writeMemberProjectRoles: (id, list) => client.writeMemberProjectRoles(id, list),
        removeOrganizationMember: (id) => client.removeOrganizationMember(id),
        writeNewProjectAccess: (projectId, userRoles) =>
          client.writeNewProjectAccess(projectId, userRoles),
        fetchProject: (projectId) => client.fetchProject(projectId),
      },
      // The member list, the app's places and the member's own grants, read again before the
      // write is reported done.
      async (orgId, places, members = []) => {
        const demands: ReadonlyArray<DetailDemand> = [
          { family: "organizationMembers", ownerId: orgId },
          ...places.map((ownerId) => ({ family: "project", listing: "project", ownerId }) as const),
          ...members.map((ownerId) => ({ family: "memberProjectRoles", ownerId }) as const),
        ];
        for (const demand of demands) input.revalidate(orgId, demand);
        await Promise.all(demands.map((demand) => input.readDetail(demand)));
      },
    );
    const team = teamExecutor(
      {
        listOrganizationMembers: (orgId) => client.listOrganizationMembers(orgId),
        updateOrganizationMember: (id, membership) =>
          client.updateOrganizationMember(id, membership),
        removeOrganizationMember: (id) => client.removeOrganizationMember(id),
      },
      // The member list and the member's own grants, read again before the write is reported done.
      async (orgId, clientUserId) => {
        const demands: ReadonlyArray<DetailDemand> = [
          { family: "organizationMembers", ownerId: orgId },
          { family: "memberProjectRoles", ownerId: clientUserId },
        ];
        for (const demand of demands) input.revalidate(orgId, demand);
        await Promise.all(demands.map((demand) => input.readDetail(demand)));
      },
      (orgId) => input.viewerOf(orgId)?.roleCode,
    );
    return {
      submit: (requestId, intent) =>
        Effect.suspend(() => {
          switch (intent.kind) {
            case "mate-deploy":
              return deploy(requestId, intent);
            case "mate-restart":
              return restart.submit(requestId, intent);
            case "delete-project":
              return remove(requestId, intent);
            case "retire-mate-key":
              return retireKey(requestId, intent);
            case "enable-subdomain-access":
              return publish(requestId, intent);
            case "start-service":
              return startOne(requestId, intent);
            case "stop-service":
              return stopOne(requestId, intent);
            case "delete-service":
              return deleteOne(requestId, intent);
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
            case "create-project":
              return create(requestId, intent);
            case "import-project":
            case "import-services":
            case "import-container":
            case "harden-project":
              return creationWrite(requestId, intent);
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
            case "publish-domains":
              return addresses.publishDomains(requestId, intent);
            case "disable-subdomain-access":
              return addresses.disableSubdomainAccess(requestId, intent);
            case "open-port":
              return addresses.openPort(requestId, intent);
            case "change-port":
              return addresses.changePort(requestId, intent);
            case "close-port":
              return addresses.closePort(requestId, intent);
            case "publish-ports":
              return addresses.publishPorts(requestId, intent);
            case "request-ipv4":
              return addresses.requestIpv4(requestId, intent);
            case "check-invitee":
              return people.check(requestId, intent);
            case "invite-member":
              return people.invite(requestId, intent);
            case "resend-invitation":
              return people.resend(requestId, intent);
            case "set-app-access":
              return people.setAccess(requestId, intent);
            case "set-org-role":
              return team.setRole(requestId, intent);
            case "remove-member":
              return team.removeMember(requestId, intent);
            case "set-project-access":
              return people.setProjectAccess(requestId, intent);
            case "grant-new-project-access":
              return people.grantNewProject(requestId, intent);
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
          viewer: input.viewerOf("orgId" in intent ? intent.orgId : ""),
          active: input.active,
          readDetail: input.readDetail,
        });
      const check = async () => {
        const answer = await Effect.runPromise(Effect.result(admission()));
        if (Result.isFailure(answer)) throw new ZeropsWriteNotSent(answer.failure);
      };
      const source = input.client;
      const generation = source.accountEpoch;
      const establish =
        intent.kind === "import-container"
          ? input.hqApiOf(intent.orgId)?.establishZcpAuthorization
          : undefined;
      const checkCredentialAccount = async () => {
        await check();
        if (source.accountEpoch !== generation)
          throw new ZeropsWriteNotSent({
            outcome: "definitive-refusal",
            message: "This Zerops sign-in has ended.",
          });
      };
      const client: ZeropsOperationsClient = {
        deployMate: (id, signal) => source.deployMate(id, signal, check),
        restartService: (id, signal) => source.restartService(id, signal, check),
        stopService: (id) => source.stopService(id, check),
        startService: (id) => source.startService(id, check),
        deleteService: (id) => source.deleteService(id, check),
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
        importDevelopmentContainer: (container, signal) =>
          source.importDevelopmentContainer(container, signal, check, async (context) => {
            await checkCredentialAccount();
            if (establish === undefined)
              throw new ZeropsWriteNotSent({
                outcome: "definitive-refusal",
                message: "HQ is not ready to record this Mate's ZCP authorization.",
              });
            try {
              await establish(context.projectId, { keyHash: context.keyHash });
            } catch (cause) {
              if (cause instanceof HqError && cause.kind === "refused")
                throw new ZeropsWriteNotSent({
                  outcome: "definitive-refusal",
                  message: cause.message,
                });
              throw cause;
            }
            await checkCredentialAccount();
            // The status reader must discard any read begun before HQ acknowledged this context.
            const key = { orgId: container.clientId, projectId: context.projectId };
            commitOwn(
              input.store,
              "hqObserveCredentialRequest",
              observeRequestScope(key),
              observeCredentialId(key),
              { requestId },
            );
          }),
        hardenMate: (orgId, projectId, signal, _before, tokenId) =>
          source.hardenMate(orgId, projectId, signal, check, tokenId),
        addProjectVariable: (id, write) => source.addProjectVariable(id, write, check),
        updateProjectVariable: (id, write) => source.updateProjectVariable(id, write, check),
        removeProjectVariable: (id) => source.removeProjectVariable(id, check),
        addServiceVariable: (id, write) => source.addServiceVariable(id, write, check),
        updateServiceVariable: (id, write) => source.updateServiceVariable(id, write, check),
        removeServiceVariable: (id) => source.removeServiceVariable(id, check),
        mintIntegrationToken: (input, signal) => source.mintIntegrationToken(input, signal, check),
        regenerateIntegrationToken: (token, signal) =>
          source.regenerateIntegrationToken(token, signal, check),
        createPublicHttpRouting: (id, routing, signal) =>
          source.createPublicHttpRouting(id, routing, signal, check),
        syncPublicHttpRouting: (id, signal) => source.syncPublicHttpRouting(id, signal, check),
        updatePublicHttpRouting: (id, routing, signal) =>
          source.updatePublicHttpRouting(id, routing, signal, check),
        deletePublicHttpRouting: (id, signal) => source.deletePublicHttpRouting(id, signal, check),
        checkPublicHttpRoutingDns: (id, signal) =>
          source.checkPublicHttpRoutingDns(id, signal, check),
        disableSubdomainAccess: (id) => source.disableSubdomainAccess(id, check),
        createPublicPortRouting: (id, port, signal) =>
          source.createPublicPortRouting(id, port, signal, check),
        updatePublicPortRouting: (id, port, signal) =>
          source.updatePublicPortRouting(id, port, signal, check),
        deletePublicPortRouting: (id, signal) => source.deletePublicPortRouting(id, signal, check),
        syncPublicPortRouting: (id, signal) => source.syncPublicPortRouting(id, signal, check),
        requestProjectPublicIp: (id, signal) => source.requestProjectPublicIp(id, signal, check),
        deleteIntegrationToken: (target, signal) =>
          source.deleteIntegrationToken(target, signal, check),
        listIntegrationTokens: (...args) => source.listIntegrationTokens(...args),
        readIntegrationToken: (...args) => source.readIntegrationToken(...args),
        fetchProject: (...args) => source.fetchProject(...args),
        listClientProjects: (...args) => source.listClientProjects(...args),
        readProjectEnv: (...args) => source.readProjectEnv(...args),
        listProjectServices: (...args) => source.listProjectServices(...args),
        listOrganizationMembers: (...args) => source.listOrganizationMembers(...args),
        readMemberProjectRoles: (...args) => source.readMemberProjectRoles(...args),
        validateOrganizationUser: (orgId, email) =>
          source.validateOrganizationUser(orgId, email, check),
        inviteOrganizationUser: (orgId, invite) =>
          source.inviteOrganizationUser(orgId, invite, check),
        connectOrganizationUser: (orgId, invite) =>
          source.connectOrganizationUser(orgId, invite, check),
        writeMemberProjectRoles: (id, list) => source.writeMemberProjectRoles(id, list, check),
        writeNewProjectAccess: (id, userRoles) =>
          source.writeNewProjectAccess(id, userRoles, check),
        removeOrganizationMember: (id) => source.removeOrganizationMember(id, check),
        updateOrganizationMember: (id, membership) =>
          source.updateOrganizationMember(id, membership, check),
      };
      return admission().pipe(Effect.andThen(assemble(client).submit(requestId, intent)));
    },
  };
}
