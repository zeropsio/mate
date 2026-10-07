import type { HqApi } from "../../../zerops/hq/client.ts";
import type { RunToEnd } from "../runToEnd.ts";

/** Key coordination for the existing harden-project operation. Only an owner-confirmed absent
 * key permits token matching; refusal and unavailable reads keep their original failure. */
export async function hardenMateProject(input: {
  readonly api: Pick<HqApi, "mateKey" | "recheckKey"> | null;
  readonly orgId: string;
  readonly projectId: string;
  readonly keyWider: boolean;
  readonly active: () => boolean;
  readonly run: RunToEnd;
  readonly unobserved: string;
}): Promise<{ readonly keyNotLowered: string | null }> {
  const check = () => {
    if (!input.active()) throw new Error("This account is no longer active.");
  };
  check();
  const keyTokenId = input.api === null ? null : await input.api.mateKey(input.projectId);
  check();
  const result = await input.run(
    {
      kind: "harden-project",
      orgId: input.orgId,
      projectId: input.projectId,
      ...(keyTokenId === null ? {} : { keyTokenId }),
    },
    { orgId: input.orgId, unobserved: input.unobserved },
  );
  check();
  if (input.keyWider && result.keyNotLowered === null && input.api !== null) {
    // A failed recheck leaves HQ's widened-key verdict in place. It cannot undo the completed
    // hardening receipt, and the menu still offers Finish setup from that retained verdict.
    await input.api.recheckKey(input.projectId).catch(() => undefined);
  }
  return result;
}
