/**
 * A person's request for read access to an environment Zerops does not show them (mate-hq
 * spec/protocol.md, Read access requests): HQ records and lists it and grants nothing. An Admin's
 * browser gives the person `READ_ONLY` on that one project at Zerops, then closes the request.
 */
import * as Schema from "effect/Schema";

export const ReadAccessRequest = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  projectId: Schema.String,
  askedAt: Schema.String,
});
export type ReadAccessRequest = typeof ReadAccessRequest.Type;

export const ReadAccessRequests = Schema.Struct({ requests: Schema.Array(ReadAccessRequest) });

/** How an Admin closes a request: after giving read access at Zerops, or instead of it. */
export type ReadAccessOutcome = "granted" | "declined";
