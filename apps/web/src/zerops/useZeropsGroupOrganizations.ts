/**
 * Which of the account's groups the broker has actually made in Gitea.
 *
 * The registry tag is what the app **asked for**; `GET /orgs/{slug}` answering
 * as the person is what **exists** (guide 4.5). The broker builds a group's
 * org, its teams, its group repo and its runner in about eighty seconds, so a
 * group created a moment ago is a real, temporary state the row says out loud
 * rather than a failure.
 *
 * Read with the person's own Gitea token. A slug that has not been answered
 * for is absent from the map — which reads as `unknown` and says nothing
 * (`resolveGroupGitea`): a line that appears and then disappears is the layout
 * shift this screen refuses.
 *
 * A group that is not there yet is asked about again until it is. The person
 * is looking at the very screen that made it, so the line has to go away on
 * its own — read once and the row would still be setting up its repositories
 * long after Gitea had them (`verified.md`, 2026-09-18).
 */

import { useEffect, useState } from "react";

import { giteaClientFor } from "./accountGiteaSessions";

const EMPTY: ReadonlyMap<string, boolean> = new Map();

/** Between two asks about a group the broker has not finished. */
const RETRY_MS = 10_000;

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
    let asking: number | undefined;

    const ask = async () => {
      const pairs = await Promise.all(
        slugs.map(async (slug) => {
          // A refusal is not an answer. Only a `404` means "not made yet", and
          // the client already turns that into `undefined`.
          const organization = await client.getOrganization(slug).catch(() => null);
          return organization === null ? null : ([slug, organization !== undefined] as const);
        }),
      );
      if (cancelled) return;
      const organizations = new Map(
        pairs.filter((pair): pair is [string, boolean] => pair !== null),
      );
      setAnswer({ key, organizations });
      // A group the broker has not finished yet is asked about again, until it
      // is there. Nothing else would ever take the line back off the row.
      if ([...organizations.values()].includes(false)) {
        asking = window.setTimeout(() => void ask(), RETRY_MS);
      }
    };
    void ask();

    return () => {
      cancelled = true;
      if (asking !== undefined) window.clearTimeout(asking);
    };
  }, [giteaOrigin, key]);

  return answer?.key === key ? answer.organizations : EMPTY;
}
