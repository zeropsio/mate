/**
 * What a person decided on a Chief's proposal (`chief.ts`): the card sits in a conversation, so the
 * decision is recorded against that conversation's project, by whoever it opens for (Basic user or
 * above there, `observe_mate`'s rule), and read back only by them. A decision is written once; an
 * approval's outcome — done, or failed with the platform's words — once after it. Anything else is
 * a conflict: two people's cards, or one card's two tabs, never disagree.
 *
 * @module proposals
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

import { Chiefs } from "./chief.ts";
import { ChiefRefused, confirmingChiefRefusal } from "./chiefRefused.ts";
import { Leader, type NotLeader } from "./leader.ts";
import { can } from "./permissions.ts";
import { Roles } from "./roles.ts";
import type { ZeropsError } from "./zerops/api.ts";

/** A proposal's id as zcp mints it (a UUID), or anything as plain. */
export const ProposalId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._:-]{1,128}$/u));

/** The words an outcome carries: the platform's failure message, bounded. */
const Words = Schema.String.check(Schema.isMaxLength(4000));

/** A decision as a person's client asks HQ to record it. */
export const ProposalAsk = Schema.Struct({
  projectId: Schema.String,
  kind: Schema.optionalKey(Schema.String),
  decision: Schema.Literals(["approved", "declined"]),
  outcome: Schema.optionalKey(Schema.Literals(["done", "failed"])),
  words: Schema.optionalKey(Words),
});
export type ProposalAsk = typeof ProposalAsk.Type;

/** A decision as HQ holds it. */
export interface StoredDecision {
  readonly projectId: string;
  readonly decision: "approved" | "declined";
  readonly outcome: "done" | "failed" | null;
  readonly words: string | null;
}

/** A decision as HQ answers it. */
export interface ProposalDecision extends StoredDecision {
  readonly id: string;
  /** The Zerops user who decided. */
  readonly by: string;
  /** When they decided, ISO. */
  readonly at: string;
}

/**
 * What asking `ask` does to the decision HQ holds (`null`: none yet): records it, records its
 * outcome, changes nothing because it is what HQ holds already, or is refused, and why.
 */
export function decisionVerdict(
  stored: StoredDecision | null,
  ask: ProposalAsk,
):
  | { readonly kind: "insert" | "outcome" | "same" }
  | {
      readonly kind: "refuse";
      readonly reason:
        | "outcome_without_approval"
        | "other_project"
        | "decided"
        | "outcome_recorded"
        | "words_without_outcome";
    } {
  if (ask.outcome !== undefined && ask.decision !== "approved") {
    return { kind: "refuse", reason: "outcome_without_approval" };
  }
  if (stored === null) return { kind: "insert" };
  if (stored.projectId !== ask.projectId) return { kind: "refuse", reason: "other_project" };
  if (stored.decision !== ask.decision) return { kind: "refuse", reason: "decided" };
  if (ask.outcome === undefined) {
    return ask.words === undefined || ask.words === stored.words
      ? { kind: "same" }
      : { kind: "refuse", reason: "words_without_outcome" };
  }
  if (stored.outcome === null) return { kind: "outcome" };
  return stored.outcome === ask.outcome && (ask.words === undefined || ask.words === stored.words)
    ? { kind: "same" }
    : { kind: "refuse", reason: "outcome_recorded" };
}

/** At most this many proposals are read in one call. */
export const PROPOSALS_PER_READ = 100;

export class ProposalDecisions extends Context.Service<
  ProposalDecisions,
  {
    /** The decisions on `ids` whose projects open for `userId`; an id HQ holds none for is left out. */
    readonly read: (
      userId: string,
      ids: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyArray<ProposalDecision>, SqlError | ZeropsError>;
    /** Records `ask` on proposal `id` for `userId` ({@link decisionVerdict}); the decision held after it. */
    readonly decide: (
      userId: string,
      id: string,
      ask: ProposalAsk,
    ) => Effect.Effect<ProposalDecision, ChiefRefused | NotLeader | SqlError | ZeropsError>;
  }
>()("@t3tools/hq/proposals/ProposalDecisions") {}

interface Row {
  readonly id: string;
  readonly project_id: string;
  readonly decision: "approved" | "declined";
  readonly outcome: "done" | "failed" | null;
  readonly words: string | null;
  readonly decided_by: string;
  readonly decided_at: string;
}

const toDecision = (row: Row): ProposalDecision => ({
  id: row.id,
  projectId: row.project_id,
  decision: row.decision,
  outcome: row.outcome,
  words: row.words,
  by: row.decided_by,
  at: row.decided_at,
});

export const proposalDecisionsLayer = Layer.effect(
  ProposalDecisions,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const leader = yield* Leader;
    const roles = yield* Roles;
    const chiefs = yield* Chiefs;
    const columns = sql.literal(`id, project_id, decision, outcome, words, decided_by,
      to_char(decided_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS decided_at`);
    const one = (id: string) =>
      Effect.map(
        sql<Row>`SELECT ${columns} FROM hq_proposal_decision WHERE id = ${id}`,
        (rows) => rows[0],
      );
    return ProposalDecisions.of({
      read: (userId, ids) =>
        Effect.gen(function* () {
          if (ids.length === 0) return [];
          const view = yield* roles.view;
          // A decision on a Mate's Chief offer is its person's alone, as deciding it is
          // (`Chiefs.authorizeProposal`).
          const rows = yield* sql<Row>`
            SELECT ${columns} FROM hq_proposal_decision d WHERE id IN ${sql.in(ids)}
              AND NOT EXISTS (
                SELECT 1 FROM hq_chief_proposal offer
                WHERE offer.id = d.id AND offer.user_id <> ${userId})`;
          return rows
            .filter(
              (row) =>
                can({ kind: "person", userId }, "observe_mate", { projectId: row.project_id }, view)
                  .allow,
            )
            .map(toDecision);
        }),
      decide: (userId, id, ask) =>
        confirmingChiefRefusal(
          Effect.gen(function* () {
            const decision = can(
              { kind: "person", userId },
              "observe_mate",
              { projectId: ask.projectId },
              yield* roles.forWrite,
            );
            if (!decision.allow) {
              return yield* new ChiefRefused({ code: "forbidden", reason: decision.reason });
            }
            yield* chiefs.authorizeProposal(
              userId,
              id,
              ask.projectId,
              ask.kind === "chief.message",
            );
            return yield* leader.write(
              Effect.gen(function* () {
                // Two answers to one card are decided one after the other, each on what the one
                // before left.
                yield* sql`SELECT pg_advisory_xact_lock(hashtext(${`proposal:${id}`}))`;
                const held = yield* one(id);
                const verdict = decisionVerdict(
                  held === undefined
                    ? null
                    : {
                        projectId: held.project_id,
                        decision: held.decision,
                        outcome: held.outcome,
                        words: held.words,
                      },
                  ask,
                );
                if (verdict.kind === "refuse") {
                  return yield* new ChiefRefused({ code: "conflict", reason: verdict.reason });
                }
                if (verdict.kind === "same" && held !== undefined) return toDecision(held);
                if (verdict.kind === "outcome") {
                  yield* sql`
                    UPDATE hq_proposal_decision
                    SET outcome = ${ask.outcome ?? null}, words = ${ask.words ?? held?.words ?? null},
                      outcome_by = ${userId}, outcome_at = now()
                    WHERE id = ${id}`;
                } else {
                  yield* sql`
                    INSERT INTO hq_proposal_decision
                      (id, project_id, decision, decided_by, outcome, words, outcome_by, outcome_at)
                    VALUES (${id}, ${ask.projectId}, ${ask.decision}, ${userId},
                      ${ask.outcome ?? null}, ${ask.words ?? null},
                      ${ask.outcome === undefined ? null : userId},
                      CASE WHEN ${ask.outcome ?? null}::text IS NULL THEN NULL ELSE now() END)`;
                }
                return toDecision((yield* one(id))!);
              }),
            );
          }),
        ),
    });
  }),
);
