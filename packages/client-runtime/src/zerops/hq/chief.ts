/**
 * The organisation's Chief mark and the decisions on its proposals, as HQ keeps them (mate-hq
 * `spec/protocol.md`, "Chief"), through the client's HQ session (`client.ts`).
 *
 * - `PUT /api/chief {projectId}` → an Owner or Admin marks the project as the organisation's Chief,
 *   or moves the mark there; HQ answers the mark it holds. The mark carries no key, so a set-up
 *   that lost its answer simply asks again.
 * - `GET /api/proposals?ids=…` → the decisions HQ holds of those proposals, at most
 *   {@link PROPOSAL_IDS_PER_READ} per call.
 * - `PUT /api/proposals/:id` → one decision, then once how an approval ended: `decision` is
 *   written once, `outcome` once after `approved`, and anything else is HQ's `409`.
 *
 * @module hq/chief
 */
import * as Schema from "effect/Schema";

/** The organisation's Chief mark: its project, and since when HQ holds it. */
export const HqChief = Schema.Struct({ projectId: Schema.NonEmptyString, since: Schema.String });
export type HqChief = typeof HqChief.Type;

/** What setting or moving the mark answers. */
export const HqChiefMarkSet = Schema.Struct({ chief: HqChief });
export type HqChiefMarkSet = typeof HqChiefMarkSet.Type;

/** One proposal's decision as HQ holds it. */
export const HqProposalDecision = Schema.Struct({
  id: Schema.NonEmptyString,
  projectId: Schema.String,
  decision: Schema.Literals(["approved", "declined"]),
  outcome: Schema.NullOr(Schema.Literals(["done", "failed"])),
  words: Schema.NullOr(Schema.String),
  by: Schema.String,
  at: Schema.String,
});
export type HqProposalDecision = typeof HqProposalDecision.Type;

const DecisionsAnswer = Schema.Struct({ decisions: Schema.Array(HqProposalDecision) });

/** What a write of a decision says: the decision first, then how an approved one ended. */
export interface HqProposalDecisionWrite {
  /** The project of the conversation the card is in. */
  readonly projectId: string;
  readonly kind?: string;
  readonly decision: "approved" | "declined";
  readonly outcome?: "done" | "failed";
  /** A failed approval's reason, in the platform's words. */
  readonly words?: string;
}

/** How many proposals one read names: HQ refuses more. */
export const PROPOSAL_IDS_PER_READ = 100;

export interface HqChiefCalls {
  readonly setChief: (projectId: string) => Promise<HqChiefMarkSet>;
  /** Every decision HQ holds of `ids`, read {@link PROPOSAL_IDS_PER_READ} at a time. */
  readonly proposalDecisions: (
    ids: ReadonlyArray<string>,
    signal?: AbortSignal,
  ) => Promise<ReadonlyArray<HqProposalDecision>>;
  readonly decideProposal: (
    id: string,
    write: HqProposalDecisionWrite,
  ) => Promise<HqProposalDecision>;
}

/** The client's session call (`makeHqApi`'s `authorized`) and its schema read (`decoded`). */
export interface HqChiefTransport {
  readonly authorized: (path: string, init?: RequestInit, write?: boolean) => Promise<Response>;
  readonly decoded: <S extends Schema.Decoder<unknown>>(
    schema: S,
  ) => (response: Response) => Promise<S["Type"]>;
}

export function makeChiefCalls({ authorized, decoded }: HqChiefTransport): HqChiefCalls {
  const readMark = decoded(HqChiefMarkSet);
  const readDecisions = decoded(DecisionsAnswer);
  const readDecision = decoded(HqProposalDecision);
  return {
    setChief: async (projectId) =>
      readMark(
        await authorized(
          "/api/chief",
          { method: "PUT", body: JSON.stringify({ projectId }) },
          true,
        ),
      ),
    proposalDecisions: async (ids, signal) => {
      const unique = [...new Set(ids)];
      const batches: string[][] = [];
      for (let start = 0; start < unique.length; start += PROPOSAL_IDS_PER_READ)
        batches.push(unique.slice(start, start + PROPOSAL_IDS_PER_READ));
      const answers = await Promise.all(
        batches.map(async (batch) => {
          const search = new URLSearchParams({ ids: batch.join(",") }).toString();
          return (
            await readDecisions(
              await authorized(`/api/proposals?${search}`, signal === undefined ? {} : { signal }),
            )
          ).decisions;
        }),
      );
      return answers.flat();
    },
    decideProposal: async (id, write) =>
      readDecision(
        await authorized(
          `/api/proposals/${encodeURIComponent(id)}`,
          { method: "PUT", body: JSON.stringify(write) },
          true,
        ),
      ),
  };
}
