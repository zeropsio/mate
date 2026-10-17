/**
 * Automated Mates in the running Core (`runningCore.ts`), as their tests set them up: a Mate's record
 * made automated, in an application or in none, enrolled, with its link open.
 *
 * @module test/harness/automated
 */
import { assert } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { enrollMate, type startCore } from "./runningCore.ts";

type Core = Effect.Success<ReturnType<typeof startCore>>;

/** A Mate's link from its credential, its first state read. */
export const linkOf = (core: Core, credential: string) =>
  Effect.gen(function* () {
    const { ticket } = (yield* core.call("POST", "/api/mate/link-ticket", {
      headers: { authorization: `Mate ${credential}` },
    })).body as { readonly ticket: string };
    const link = yield* core.socket(`/api/mate/link?ticket=${ticket}`);
    const state = yield* link.next("state");
    return { link, state };
  });

/**
 * The Mate of `projectId`, made by `owner` — automated unless said otherwise — in the application
 * `appId` or in none, enrolled, its link open.
 */
export const mateLinked = (
  core: Core,
  owner: string,
  projectId: string,
  options: { readonly appId?: string; readonly automated?: boolean } = {},
) =>
  Effect.gen(function* () {
    const automated = options.automated ?? true;
    const made =
      options.appId === undefined
        ? yield* core.call("POST", "/api/mates", {
            session: owner,
            body: { projectId, face: "face-1", automated },
          })
        : yield* core.call("POST", `/api/apps/${options.appId}/projects`, {
            session: owner,
            body: { projectId, kind: "mate", mate: { face: "face-1", automated } },
          });
    assert.strictEqual(made.status, 201);
    const credential = yield* enrollMate(core.call, core.fake, projectId);
    const { link, state } = yield* linkOf(core, credential);
    return { credential, auth: { authorization: `Mate ${credential}` }, link, state };
  });
