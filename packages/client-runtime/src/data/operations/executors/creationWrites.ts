/**
 * The writes a creation makes at Zerops after its project — a whole project imported, services
 * imported, a Mate's container imported, a project hardened — each answered at once: its answer is
 * its end. Zerops keeps no request ids; a lost answer is the coordinator's to resolve.
 *
 * @module data/operations/executors/creationWrites
 */
import * as Effect from "effect/Effect";

import type { ZeropsApiClient, ZeropsServiceImportResult } from "../../../zerops/api.ts";
import type { CreateServicesResult } from "../createServices.ts";
import type { OperationIntent, OperationReceipt, OperationResult } from "../../model.ts";
import type { OperationExecutor } from "../coordinator.ts";
import type { IntentOf } from "../kind.ts";
import { answeredReceipt } from "./answered.ts";
import { verb } from "./write.ts";

export interface CreationWritesPlatform {
  readonly importProject: (
    clientId: string,
    yaml: string,
  ) => Promise<{ readonly projectId: string }>;
  readonly importServicesIntoProject: (projectId: string, yaml: string) => Promise<unknown>;
  readonly importDevelopmentContainer: (
    input: Parameters<ZeropsApiClient["importDevelopmentContainer"]>[0],
  ) => Promise<{
    readonly serviceName: string;
    readonly imported: boolean;
    readonly processId?: string;
  }>;
  readonly hardenMate: (
    clientId: string,
    projectId: string,
    keyTokenId: string | undefined,
  ) => Promise<{ readonly keyNotLowered: string | null }>;
}

type ProjectWrite = IntentOf<
  "import-project" | "import-services" | "import-container" | "harden-project"
>;

/** Done as Zerops answered, with what it answered where the kind declares a result. */
const done = (
  requestId: string,
  projectId: string,
  result: OperationResult | undefined,
): OperationReceipt => ({
  ...answeredReceipt(requestId, { family: "project", id: projectId }),
  acceptance: { kind: "accepted", ...(result === undefined ? {} : { result }) },
});

export function creationWritesExecutor(
  platform: CreationWritesPlatform,
): OperationExecutor["submit"] {
  return (requestId: string, intent: OperationIntent) => {
    const write = intent as ProjectWrite;
    switch (write.kind) {
      case "import-project":
        return Effect.map(
          verb(() => platform.importProject(write.orgId, write.yaml)),
          ({ projectId }) => done(requestId, projectId, { projectId }),
        );
      case "import-services":
        return Effect.map(
          verb(() => platform.importServicesIntoProject(write.projectId, write.yaml)),
          () => done(requestId, write.projectId, undefined),
        );
      case "import-container":
        return Effect.map(
          verb(() =>
            platform.importDevelopmentContainer({
              clientId: write.orgId,
              projectId: write.projectId,
              projectName: write.projectName,
              agents: write.agents,
              ...(write.tierYaml === undefined ? {} : { tierYaml: write.tierYaml }),
              ...(write.birthplace === undefined ? {} : { birthplace: write.birthplace }),
            }),
          ),
          ({ serviceName, imported, processId }) =>
            done(requestId, write.projectId, {
              serviceName,
              imported,
              ...(processId === undefined ? {} : { processId }),
            }),
        );
      case "harden-project":
        return Effect.map(
          verb(() => platform.hardenMate(write.orgId, write.projectId, write.keyTokenId)),
          ({ keyNotLowered }) =>
            done(requestId, write.projectId, {
              keyNotLowered,
            }),
        );
    }
  };
}

/**
 * Creating a project's missing services, followed to its end (`create-services`): Zerops' answer
 * names each service it began and the processes bringing it up, which the receipt holds as its
 * handles until each ended. An answer naming no process is its end.
 */
export function createServicesExecutor(platform: {
  readonly importServicesIntoProject: (
    projectId: string,
    yaml: string,
  ) => Promise<ZeropsServiceImportResult>;
  readonly nowMs: () => number;
}) {
  return (requestId: string, intent: IntentOf<"create-services">) =>
    Effect.map(
      verb(() => platform.importServicesIntoProject(intent.projectId, intent.yaml)),
      (answer): OperationReceipt => {
        const services = (answer.serviceStacks ?? []).map((stack) => ({
          hostname: stack.name,
          serviceId: stack.id,
          processIds: (stack.processes ?? []).map((process) => process.id),
        }));
        const result: CreateServicesResult = {
          acceptedAtMs: platform.nowMs(),
          services,
        };
        const processes = [...new Set(services.flatMap((service) => service.processIds))];
        const [first] = processes;
        if (first === undefined) return done(requestId, intent.projectId, result);
        return {
          requestId,
          operationId: first,
          executor: "zerops",
          affected: [
            { family: "project", id: intent.projectId },
            ...processes.map((id) => ({ family: "process" as const, id })),
          ],
          handles: processes,
          acceptance: { kind: "accepted", result },
          outcome: { kind: "pending" },
        };
      },
    );
}
