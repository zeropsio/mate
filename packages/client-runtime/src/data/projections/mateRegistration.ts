/** Registration outlives its press: only the newest registration operation replaces its verdict. */
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
import { operationEnd, operationStop } from "./operationEnd.ts";

export interface RegistrationKey {
  readonly orgId: string;
  readonly projectId: string;
}
export type MateRegistration =
  | { readonly attempt: number; readonly state: "waiting" | "active" | "done" }
  | { readonly attempt: number; readonly state: "unfinished"; readonly reason: string };

export const registrationRequestId = (
  { orgId, projectId }: RegistrationKey,
  attempt: number,
): string => `mate-registration:${orgId}/${projectId}#${attempt}`;

export const mateRegistration: Projection<RegistrationKey, MateRegistration> = {
  name: "mateRegistration",
  keyOf: ({ orgId, projectId }) => `${orgId}/${projectId}`,
  equals: sameValue,
  derive: (read, key) => {
    let latest: MateRegistration = { attempt: 0, state: "waiting" };
    for (let attempt = 1; ; attempt += 1) {
      const requestId = registrationRequestId(key, attempt);
      const operation = read.operation(requestId);
      if (operation === undefined) return latest;
      const end = operationEnd.derive(read, { requestId, orgId: key.orgId });
      const stopped = end === null ? undefined : operationStop(end, operation);
      latest =
        stopped === undefined
          ? { attempt, state: "active" }
          : stopped === null
            ? { attempt, state: operation.intent.kind === "bind-birth" ? "active" : "done" }
            : {
                attempt,
                state: "unfinished",
                reason: stopped.reason ?? "HQ isn't answering. HQ may have taken it anyway.",
              };
    }
  },
};
