/** The web and desktop read the account's retained feed projections. Mobile keeps its current path. */
import { mateFeedAtom } from "@t3tools/client-runtime/data";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
const lifecycle = Atom.family((key: string) => {
  const [environmentId, input] = JSON.parse(key) as [
    EnvironmentId,
    { readonly threadId: ThreadId },
  ];
  return mateFeedAtom({ family: "mateLifecycle", environmentId, input });
});
const agentAuth = Atom.family((environmentId: EnvironmentId) =>
  mateFeedAtom({ family: "mateAgentAuth", environmentId, input: {} }),
);
const crew = Atom.family((environmentId: EnvironmentId) =>
  mateFeedAtom({ family: "mateCrew", environmentId, input: {} }),
);
const standUpVerdict = Atom.family((environmentId: EnvironmentId) =>
  mateFeedAtom({ family: "mateStandUpVerdict", environmentId, input: {} }),
);
export const zeropsFeeds = {
  lifecycle: (target: {
    readonly environmentId: EnvironmentId;
    readonly input: { readonly threadId: ThreadId };
  }) => lifecycle(JSON.stringify([target.environmentId, target.input])),
  agentAuth: (target: {
    readonly environmentId: EnvironmentId;
    readonly input: Record<string, never>;
  }) => agentAuth(target.environmentId),
  crew: (target: {
    readonly environmentId: EnvironmentId;
    readonly input: Record<string, never>;
  }) => crew(target.environmentId),
  /** zcp's stand-up verdict, from the Mate's signed-in socket. */
  standUpVerdict: (environmentId: EnvironmentId) => standUpVerdict(environmentId),
};
