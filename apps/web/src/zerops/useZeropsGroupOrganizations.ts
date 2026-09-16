/**
 * Which of the account's groups the broker has actually made in Gitea.
 *
 * The registry tag is what the app **asked for**; `GET /orgs/{slug}` answering
 * as the person is what **exists** (guide 4.5). The broker builds a group's
 * org, its teams, its group repo and its runner in about eighty seconds, so a
 * group created a moment ago is a real, temporary state the row says out loud
 * rather than a failure.
 *
 * Read once per set of slugs, with the person's own Gitea token. A slug that
 * has not been answered for is absent from the map — which reads as `unknown`
 * and says nothing (`resolveGroupGitea`): a line that appears and then
 * disappears is the layout shift this screen refuses.
 */

import { useEffect, useState } from "react";

import { giteaClientFor } from "./giteaSession";

const EMPTY: ReadonlyMap<string, boolean> = new Map();

export function useZeropsGroupOrganizations(input: {
  readonly giteaOrigin: string | undefined;
  readonly slugs: ReadonlyArray<string>;
  readonly enabled: boolean;
}): ReadonlyMap<string, boolean> {
  const { enabled, giteaOrigin } = input;
  // A slug is `[a-z][a-z0-9-]*`, so a comma cannot appear in one and the key
  // is unambiguous.
  const key = enabled && giteaOrigin !== undefined ? [giteaOrigin, ...input.slugs].join(",") : "";
  const [answer, setAnswer] = useState<{
    readonly key: string;
    readonly organizations: ReadonlyMap<string, boolean>;
  } | null>(null);

  useEffect(() => {
    if (key === "" || giteaOrigin === undefined) return;
    const client = giteaClientFor(giteaOrigin);
    // Not signed in to Gitea in this tab: nothing can be proved, so nothing is
    // said.
    if (client === null) return;
    const slugs = key.split(",").slice(1);
    if (slugs.length === 0) return;
    let cancelled = false;
    void Promise.all(
      slugs.map(async (slug) => {
        // A refusal is not an answer. Only a `404` means "not made yet", and
        // the client already turns that into `undefined`.
        const organization = await client.getOrganization(slug).catch(() => null);
        return organization === null ? null : ([slug, organization !== undefined] as const);
      }),
    ).then((pairs) => {
      if (cancelled) return;
      setAnswer({
        key,
        organizations: new Map(pairs.filter((pair): pair is [string, boolean] => pair !== null)),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [giteaOrigin, key]);

  return answer?.key === key ? answer.organizations : EMPTY;
}
