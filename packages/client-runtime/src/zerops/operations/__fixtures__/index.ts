/**
 * Five real threads exported from a mate server, used to test the operations
 * reducer against real Claude Code + Zerops transcripts rather than
 * hand-written payloads. See
 * `../../../../../../../zcp/plans/mate-chat-output-concept-2026-09-03.md` §1.
 */
import type { OrchestrationThreadActivity } from "@t3tools/contracts";

import addMariadbJson from "./add-mariadb.json" with { type: "json" };
import adoptTwoServicesJson from "./adopt-two-services.json" with { type: "json" };
import mountStatusJson from "./mount-status.json" with { type: "json" };
import verifyAndRefusedDeployJson from "./verify-and-refused-deploy.json" with { type: "json" };
import weatherdashFirstDeployJson from "./weatherdash-first-deploy.json" with { type: "json" };

export interface ZeropsShowcaseThread {
  readonly threadId: string;
  readonly name: string;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly messages: ReadonlyArray<unknown>;
}

/** Onboarding → bootstrap → import → develop → deploy → verify, one new static service. */
export const weatherdashFirstDeploy = weatherdashFirstDeployJson as unknown as ZeropsShowcaseThread;

/** "Add a managed MariaDB database service alongside weatherdash." */
export const addMariadb = addMariadbJson as unknown as ZeropsShowcaseThread;

/** Adopt two existing services, an ambiguous dev/stage pairing rejected and retried. */
export const adoptTwoServices = adoptTwoServicesJson as unknown as ZeropsShowcaseThread;

/** A healthy verify followed by a deploy zcp refuses for a missing `zerops.yml`. */
export const verifyAndRefusedDeploy = verifyAndRefusedDeployJson as unknown as ZeropsShowcaseThread;

/** A single `zerops_mount action=status` call — nothing else. */
export const mountStatus = mountStatusJson as unknown as ZeropsShowcaseThread;

export const ZEROPS_SHOWCASE_THREADS: ReadonlyArray<ZeropsShowcaseThread> = [
  weatherdashFirstDeploy,
  addMariadb,
  adoptTwoServices,
  verifyAndRefusedDeploy,
  mountStatus,
];
