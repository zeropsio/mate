/**
 * The organization's member list as the Zerops read (`GET /client/{id}/user/list`) answers it, put
 * into an account's store: for tests of the surfaces that name people by their Zerops user id.
 */
import { membersScope } from "../families/organizationMembers.ts";
import type { AccountStore } from "../store.ts";

type SeededPeople = Readonly<
  Record<
    string,
    {
      readonly name: string;
      readonly avatarUrl?: string | null;
      /** Their membership's id; `cu-<user id>` unless a test names it. */
      readonly clientUserId?: string;
    }
  >
>;

/** `people`, by user id, as the organization's member list (`GET /client/{id}/user/list`) answers. */
export function seedMembers(store: AccountStore, orgId: string, people: SeededPeople): void {
  const scope = membersScope(orgId);
  for (const streamEvent of [
    { kind: "demand", demanded: true },
    { kind: "attempt" },
    { kind: "handshake" },
  ] as const)
    store.dispatch({ kind: "stream", key: scope, now: 0, event: streamEvent });
  const generation = store.state().streams.get(scope)?.generation ?? 0;
  store.dispatch({ kind: "baseline-begin", scope, generation });
  store.dispatch({
    kind: "baseline-commit",
    scope,
    generation,
    via: "zerops-read",
    members: [orgId],
    rows: [
      {
        family: "organizationMembers",
        id: orgId,
        revision: { kind: "zerops", version: null },
        value: Object.entries(people).map(([userId, person]) => ({
          id: person.clientUserId ?? `cu-${userId}`,
          userId,
          status: "ACTIVE",
          user: {
            id: userId,
            fullName: person.name,
            avatar:
              person.avatarUrl === undefined || person.avatarUrl === null
                ? null
                : { smallAvatarUrl: person.avatarUrl },
          },
        })),
      },
    ],
  });
}
