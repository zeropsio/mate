import { admitPlatformOperation } from "./platformAdmission.ts";
import { commitOwn } from "../../adapters/hqSettingsReads.ts";
import { observeCredentialId, observeRequestScope } from "../../families/hqObserveCredential.ts";
import type { ObserveCredential } from "../../../zerops/hq/observeCredential.ts";
import {
  validateOrganizationUser,
  inviteOrganizationUser,
  connectOrganizationUser,
  readMemberProjectRoles,
  writeMemberProjectRoles,
  updateOrganizationMember,
  removeOrganizationMember,
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
import type { AtomRegistry } from "effect/reactivity";

import { ZeropsApiError, ZeropsWriteNotSent } from "../../../zerops/errors.ts";
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
import { startProject } from "../../../zerops/api/project.ts";
import {
  deleteIntegrationToken,
  readIntegrationToken,
} from "../../../zerops/api/integrationTokens.ts";
import { HqError, type HqApi } from "../../../zerops/hq/client.ts";
import {
  makeProjectTagWriter,
  makeInMemoryProjectTagLocks,
  type ProjectTagLocks,
} from "./projectTags.ts";
import type { DetailDemand } from "../../demand.ts";
import { readsOfState, type AccountStore } from "../../store.ts";
import { projectsScope } from "../../families/project.ts";
import { projectVariablesScope } from "../../families/projectVariables.ts";
import { historyScope } from "../../families/process.ts";
import { effectProcessOf } from "../../projections/lostAnswer.ts";
import type { StreamFault } from "../../streamMachine.ts";
import type { RunToEnd } from "../runToEnd.ts";
import type { OperationExecutor } from "../coordinator.ts";
import type { IntentOf } from "../kind.ts";
import { createProjectExecutor } from "./createProject.ts";
import { deleteProjectExecutor } from "./deleteProject.ts";
import { readRetiredMateKey, retireMateKeyExecutor } from "./mateDeletion.ts";
import { mateKeyRetirementAllowed } from "../mateDeletion.ts";
import { createServicesExecutor, creationWritesExecutor } from "./creationWrites.ts";
import { mateDeployExecutor } from "./mateDeploy.ts";
import { mateRestartOwner } from "./mateRestart.ts";
import {
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
import { cancelBuildExecutor } from "./pipelineWrites.ts";
import { addressWritesExecutor, type AddressPlatform } from "./addressWrites.ts";
import { appAccessExecutor, type AppAccessPlatform } from "./appAccess.ts";
import { teamExecutor, type TeamPlatform } from "./team.ts";
import { serviceRestartExecutor, vaultWriteExecutor, type VaultPlatform } from "./vaultWrites.ts";
import { answeredReceipt } from "./answered.ts";

/** Expand the random-string expression used by shipped tiers, only for a missing key. */
function expandTierVariable(value: string): string {
  const expanded = value.replace(/<@generateRandomString\(<(\d+)>\)>/gu, (_whole, raw: string) => {
    const length = Number(raw);
    if (!Number.isSafeInteger(length) || length < 1 || length > 1024)
      throw new Error("The tier's random-string length is invalid.");
    // 62 characters divide 248 evenly, so rejection sampling avoids modulo bias.
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let output = "";
    while (output.length < length) {
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(length - output.length));
      for (const byte of bytes) if (byte < 248) output += alphabet[byte % alphabet.length];
    }
    return output;
  });
  if (expanded.includes("<@"))
    throw new Error("The tier uses an unsupported generator expression.");
  return expanded;
}

type ZeropsOperationsClient = Pick<
  ZeropsApiClient,
  | "deployMate"
  | "deleteProject"
  | "writeMateFlag"
  | "installMateKey"
  | "fetchProject"
  | "writeProject"
  | "createProject"
  | "listClientProjects"
  | "importProject"
  | "importServicesIntoProject"
  | "importDevelopmentContainer"
  | "hardenMate"
  | "listProjectServices"
  | "door"
  | "writeNewProjectAccess"
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
};

export function makeZeropsExecutor(input: {
  readonly client: ZeropsOperationsClient & Pick<ZeropsApiClient, "accountEpoch">;
  /** Capture this operation's HQ/person before native credential establishment can yield. */
  readonly hqApiOf: (
    orgId: string,
  ) => Pick<HqApi, "establishZcpAuthorization" | "createMate"> | null;
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
  const prepareVariables = async (intent: IntentOf<"prepare-tier-variables">) => {
    const demand = { family: "projectVariables", ownerId: intent.projectId } as const;
    const release = input.demandDetail(demand);
    try {
      if (!(await input.readDetail(demand)))
        throw new Error("The project's variables could not be read.");
      const read = readsOfState(input.store.state());
      const fact = read.fact("projectVariables", intent.projectId);
      if (
        read.coverage(projectVariablesScope(intent.orgId, intent.projectId)) !== "complete" ||
        fact.kind !== "known" ||
        !fact.value.complete
      )
        throw new Error("The project's variables are not fully available yet.");
      const existing = new Set(fact.value.rows.map((row) => row.key.toLowerCase()));
      for (const variable of intent.variables) {
        if (existing.has(variable.key.toLowerCase())) continue;
        await input.run(
          {
            kind: "vault-write",
            orgId: intent.orgId,
            projectId: intent.projectId,
            scope: { kind: "shared" },
            write: {
              kind: "add",
              key: variable.key,
              value: expandTierVariable(variable.value),
              sensitive: variable.sensitive,
            },
          },
          { orgId: intent.orgId, unobserved: "The project variable write could not be followed." },
        );
        existing.add(variable.key.toLowerCase());
      }
    } finally {
      release();
    }
  };
  type AdmittedClient = Omit<ZeropsOperationsClient, "door"> &
    VaultPlatform &
    AddressPlatform &
    Parameters<typeof enableSubdomainAccessExecutor>[0] &
    ServiceLifecycle &
    Parameters<typeof retireMateKeyExecutor>[0] &
    AppAccessPlatform &
    TeamPlatform;
  const assemble = (client: AdmittedClient): OperationExecutor => {
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
    const startAll = startProjectExecutor({
      startProject: (projectId) => client.startProject(projectId),
    });
    const enableMate = enableZeropsMateExecutor({
      register: async ({ orgId, projectId, serviceId, record }) => {
        const hq = input.hqApiOf(orgId);
        if (hq === null || record === undefined)
          throw new ZeropsWriteNotSent({
            outcome: "definitive-refusal",
            message: "HQ is not ready to record this Mate.",
          });
        try {
          await hq.createMate({ projectId, serviceId, face: record.face });
        } catch (cause) {
          // HQ's refusal is final and says why; anything else may have written the record.
          if (cause instanceof HqError && cause.kind === "refused")
            throw new ZeropsWriteNotSent({ outcome: "definitive-refusal", message: cause.message });
          throw cause;
        }
      },
      installMateKey: ({ orgId, projectId, projectName, serviceId }) =>
        client.installMateKey({ clientId: orgId, projectId, projectName, serviceId }),
      writeMateFlag: (serviceId) => client.writeMateFlag(serviceId),
      variablesWritten: ({ orgId, serviceId }) =>
        input.revalidate(orgId, { family: "mateVariables", ownerId: serviceId }),
      restartService: (serviceId) => client.restartService(serviceId),
    });
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
        Effect.suspend((): ReturnType<OperationExecutor["submit"]> => {
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
            case "cancel-build":
              return cancel(requestId, intent);
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
            case "create-project":
              return create(requestId, intent);
            case "prepare-tier-variables":
              return Effect.map(
                Effect.tryPromise({
                  try: () => prepareVariables(intent),
                  catch: (cause) => ({
                    outcome: "definitive-refusal" as const,
                    message:
                      cause instanceof Error
                        ? cause.message
                        : "Preparing project variables failed.",
                  }),
                }),
                () =>
                  answeredReceipt(requestId, { family: "projectVariables", id: intent.projectId }),
              );
            case "import-project":
            case "import-services":
            case "import-container":
            case "harden-project":
              return creationWrite(requestId, intent);
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
        const answer = yield* readRetiredMateKey(
          {
            readIntegrationToken: (orgId, tokenId) =>
              readIntegrationToken(input.client.door, orgId, tokenId),
          },
          requestId,
          intent,
        );
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
      const client: AdmittedClient = {
        deployMate: (id, signal) => source.deployMate(id, signal, check),
        restartService: (id) => restartService(source.door, id, undefined, check),
        stopService: (id) => stopService(source.door, id, check),
        cancelBuild: (id) => cancelBuild(source.door, id, check),
        startService: (id) => startService(source.door, id, check),
        deleteService: (id) => deleteService(source.door, id, check),
        deleteProject: (id, signal) => source.deleteProject(id, signal, check),
        enableSubdomainAccess: (id) => enableSubdomainAccess(source.door, id, check),
        writeMateFlag: (id) => source.writeMateFlag(id, check),
        installMateKey: (key) => source.installMateKey(key, check),
        startProject: (id) => startProject(source.door, id, check),
        writeProject: (project, record) => source.writeProject(project, record, check),
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
            let answer: ObserveCredential;
            try {
              answer = await establish(context.projectId, { keyHash: context.keyHash });
            } catch (cause) {
              if (cause instanceof HqError && cause.kind === "refused")
                throw new ZeropsWriteNotSent({
                  outcome: "definitive-refusal",
                  message: cause.message,
                });
              // The import is unsent, but HQ may already have authorized the key.
              throw new ZeropsApiError(
                cause instanceof Error ? cause.message : "HQ could not confirm authorization.",
                "uncertain",
              );
            }
            await checkCredentialAccount();
            // HQ's answer is the status now, over any read begun before it.
            const key = { orgId: container.clientId, projectId: context.projectId };
            commitOwn(
              input.store,
              "hqObserveCredentialRequest",
              observeRequestScope(key),
              observeCredentialId(key),
              { requestId, answer },
            );
          }),
        hardenMate: (orgId, projectId, signal, _before, tokenId) =>
          source.hardenMate(orgId, projectId, signal, check, tokenId),
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
        deleteIntegrationToken: (target) =>
          deleteIntegrationToken(source.door, target, undefined, check),
        readIntegrationToken: (orgId, tokenId) => readIntegrationToken(source.door, orgId, tokenId),
        fetchProject: (...args) => source.fetchProject(...args),
        listClientProjects: (...args) => source.listClientProjects(...args),
        listProjectServices: (...args) => source.listProjectServices(...args),
        listOrganizationMembers: (orgId) => listOrganizationMembers(source.door, orgId),
        readMemberProjectRoles: (id) => readMemberProjectRoles(source.door, id),
        validateOrganizationUser: (orgId, email) =>
          validateOrganizationUser(source.door, orgId, email, check),
        inviteOrganizationUser: (orgId, invite) =>
          inviteOrganizationUser(source.door, orgId, invite, check),
        connectOrganizationUser: (orgId, invite) =>
          connectOrganizationUser(source.door, orgId, invite, check),
        writeMemberProjectRoles: (id, list) =>
          writeMemberProjectRoles(source.door, id, list, check),
        writeNewProjectAccess: (id, userRoles) =>
          source.writeNewProjectAccess(id, userRoles, check),
        removeOrganizationMember: (id) => removeOrganizationMember(source.door, id, check),
        updateOrganizationMember: (id, membership) =>
          updateOrganizationMember(source.door, id, membership, check),
      };
      return admission().pipe(
        Effect.mapError((fault) => ({ ...fault, writeNotSent: true as const })),
        Effect.andThen(assemble(client).submit(requestId, intent)),
      );
    },
  };
}
