/**
 * The writes a creation makes at Zerops after its project — a whole project imported, services
 * imported, a Mate's container imported, a project hardened — each answered at once: its answer is
 * its end. Zerops keeps no request ids; a lost answer is the coordinator's to resolve.
 *
 * @module data/operations/executors/creationWrites
 */
import * as Effect from "effect/Effect";

import type { ZeropsApiClient } from "../../../zerops/api.ts";
import { PROJECT_ENV_ISOLATION_KEY, readsClosed } from "../../../zerops/projectIsolation.ts";
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
  readonly readProjectEnv: (
    clientId: string,
    projectId: string,
  ) => Promise<ReadonlyArray<{ readonly key: string; readonly content?: string | undefined }>>;
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

const refused = (message: string) =>
  Effect.fail({ outcome: "definitive-refusal", message } as const);

export function creationWritesExecutor(
  platform: CreationWritesPlatform,
): OperationExecutor["submit"] {
  const isolation = (intent: IntentOf<"harden-project">) =>
    Effect.flatMap(
      verb(() => platform.readProjectEnv(intent.orgId, intent.projectId)),
      (entries) =>
        Effect.succeed(entries.find((entry) => entry.key === PROJECT_ENV_ISOLATION_KEY)?.content),
    );
  const harden = (intent: IntentOf<"harden-project">) =>
    verb(() => platform.hardenMate(intent.orgId, intent.projectId, intent.keyTokenId));
  const hardened = (intent: IntentOf<"harden-project">) =>
    intent.confirm !== true
      ? harden(intent)
      : Effect.gen(function* () {
          const before = yield* isolation(intent);
          if (before === undefined)
            return yield* refused("The project's isolation could not be read.");
          if (readsClosed(before)) return { keyNotLowered: null };
          const answer = yield* harden(intent);
          const after = yield* isolation(intent);
          if (after === undefined)
            return yield* refused("The project's isolation could not be read.");
          if (!readsClosed(after))
            return yield* refused("The project does not read as closed off yet.");
          return answer;
        });

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
              ...(write.setupRuntimesYaml === undefined
                ? {}
                : { setupRuntimesYaml: write.setupRuntimesYaml }),
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
        return Effect.map(hardened(write), ({ keyNotLowered }) =>
          done(requestId, write.projectId, {
            keyNotLowered,
          }),
        );
    }
  };
}
