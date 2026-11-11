/**
 * A Zerops organisation a test holds, as the Mate's own access list reads it: each person active at
 * the org role given, with no override on the project. The list is the real one
 * (`ZeropsMateAccessList.make`) over that read, so a test admits from Zerops alone.
 *
 * @module accessScene
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import type { AccessRead } from "../ZeropsAccessRead.ts";
import { make, ZeropsMateAccessList } from "../ZeropsMateAccessList.ts";

/** Each person's org role, by Zerops user id. */
export type SceneRoles = Readonly<Record<string, string>>;

/** The read Zerops answers for `roles`: every person active, no project override. */
export const sceneRead = (roles: SceneRoles, tagList: ReadonlyArray<string> = []): AccessRead => ({
  kind: "read",
  project: { clientId: "org", overrides: {}, tagList: [...tagList] },
  members: Object.entries(roles).map(([userId, orgRole]) => ({
    clientUserId: `cu-${userId}`,
    userId,
    orgRole,
    status: "ACTIVE",
    canCreateProjects: false,
  })),
});

/** Nobody the scene names: a ticket for them makes the list read Zerops again. */
const NOBODY = "nobody-in-the-organisation";

/**
 * The Mate's own list over an organisation holding `roles`. `set` changes what Zerops holds and
 * returns once the list has read it, as a ticket for somebody the list does not open for makes it.
 */
export const makeAccessScene = (roles: SceneRoles) =>
  Effect.gen(function* () {
    const held = yield* Ref.make(roles);
    const list = yield* make({ projectId: "P_MATE", read: Effect.map(Ref.get(held), sceneRead) });
    const set = (next: SceneRoles) =>
      Ref.set(held, next).pipe(Effect.andThen(list.admits(NOBODY)), Effect.asVoid);
    return { list, set };
  });

/** What the scene's organisation holds, for a test that reaches the list through layers. */
export class AccessScene extends Context.Service<
  AccessScene,
  { readonly set: (roles: SceneRoles) => Effect.Effect<void> }
>()("t3/zerops/testing/accessScene") {}

/** The list over an organisation holding `roles`, with the scene that changes it. */
export const accessSceneLayer = (roles: SceneRoles) =>
  Layer.effectContext(
    Effect.map(makeAccessScene(roles), ({ list, set }) =>
      Context.make(ZeropsMateAccessList, list).pipe(Context.add(AccessScene, { set })),
    ),
  );
