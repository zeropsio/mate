import { RecipeTier } from "@t3tools/shared/hqRecipe";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** The agents HQ accepts in a birth intent, in the container's presentation order. */
export const BirthAgent = Schema.Literals([
  "claude-code",
  "codex",
  "antigravity",
  "grok",
  "cursor",
]);
export type BirthAgent = typeof BirthAgent.Type;

/** The non-secret inputs HQ retains so another device can continue this birth. */
const BirthIntentSchema = Schema.Struct({
  projectName: Schema.String,
  recipe: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("none") }),
    Schema.Struct({
      kind: Schema.Literal("tier"),
      id: Schema.Literal("group"),
      revision: Schema.String,
      tier: RecipeTier,
    }),
  ]),
  agents: Schema.Array(BirthAgent),
  standUp: Schema.Boolean,
  automated: Schema.Boolean,
  placement: Schema.Struct({
    role: Schema.Literals(["dev", "devstage", "stage", "prod"]),
    name: Schema.String,
    chief: Schema.Boolean,
  }),
  location: Schema.NullOr(Schema.String),
  userRoles: Schema.Array(Schema.Struct({ clientUserId: Schema.String, roleCode: Schema.String })),
});

export type BirthIntent = typeof BirthIntentSchema.Type;

const decode = Schema.decodeUnknownOption(BirthIntentSchema);

/** An unreadable plan cannot authorize a continuation using guessed creation inputs. */
export function readBirthIntent(value: unknown): BirthIntent | undefined {
  return Option.getOrUndefined(decode(value));
}
