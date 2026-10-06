/**
 * HQ's update at Zerops: an app version named after the carried Core, its archive uploaded, then
 * built and deployed — answered with the build's process, the operation's handle. A person without
 * full access to HQ's project is told so.
 *
 * @module data/operations/executors/hqUpdate
 */
import * as Effect from "effect/Effect";

import { ZeropsApiError } from "../../../zerops/api.ts";
import { HQ_SETUP, hqCoreVersionName, type HqCoreArtifact } from "../../../zerops/hq/birth.ts";
import type { OperationReceipt } from "../../model.ts";
import type { IntentOf } from "../kind.ts";
import { verb } from "./write.ts";

/** What a person without full access to HQ's project is told. */
export const HQ_UPDATE_FORBIDDEN =
  "Zerops refused: you need full access to Headquarters. Ask an organization owner.";

export function hqUpdateExecutor(platform: {
  /** The Core this app carries, read once the update runs: its archive is the size of Core. */
  readonly core: () => Promise<HqCoreArtifact>;
  readonly createAppVersion: (serviceId: string, name: string) => Promise<{ readonly id: string }>;
  readonly uploadAppVersionArchive: (
    appVersionId: string,
    archive: Uint8Array<ArrayBuffer>,
  ) => Promise<void>;
  readonly buildAndDeployAppVersion: (
    appVersionId: string,
    input: { readonly zeropsYaml: string; readonly setup: string },
  ) => Promise<{ readonly processId: string }>;
}) {
  const deploy = async (intent: IntentOf<"hq-update">) => {
    const core = await platform.core();
    const { id } = await platform.createAppVersion(intent.serviceId, hqCoreVersionName(core.build));
    await platform.uploadAppVersionArchive(id, core.archive);
    return platform.buildAndDeployAppVersion(id, { zeropsYaml: core.zeropsYaml, setup: HQ_SETUP });
  };
  return (requestId: string, intent: IntentOf<"hq-update">) =>
    Effect.map(
      verb(() =>
        deploy(intent).catch((cause: unknown) => {
          throw cause instanceof ZeropsApiError && cause.kind === "forbidden"
            ? new ZeropsApiError(HQ_UPDATE_FORBIDDEN, "forbidden", cause.status)
            : cause;
        }),
      ),
      ({ processId }): OperationReceipt => ({
        requestId,
        operationId: processId,
        executor: "zerops",
        affected: [{ family: "process", id: processId }],
        handles: [processId],
        acceptance: { kind: "accepted" },
        outcome: { kind: "pending" },
      }),
    );
}
