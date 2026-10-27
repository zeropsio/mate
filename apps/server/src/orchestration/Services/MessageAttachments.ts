/**
 * MessageAttachments — the claim a message's attachments go through before a turn, named for
 * callers outside orchestration (crew): only the sender's pending uploads are claimed into the
 * thread, exactly as a thread message's dispatch claims them (`Normalizer.ts`).
 */
export { pendingUploadOf } from "../../attachmentStore.ts";
export { claimMessageAttachments, releaseClaimedAttachments } from "../Normalizer.ts";
