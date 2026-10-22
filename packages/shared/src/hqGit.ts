/** HTTPS Git at HQ: a person's Git passwords. */
import * as Schema from "effect/Schema";

/** One password, shown once. Its metadata can be listed and revoked by its owner. */
const CredentialFields = {
  id: Schema.String,
  appId: Schema.String,
  createdAt: Schema.String,
  expiresAt: Schema.String,
};
export const GitCredentialRecord = Schema.Struct(CredentialFields);
export type GitCredentialRecord = typeof GitCredentialRecord.Type;
export const GitCredential = Schema.Struct({ ...CredentialFields, token: Schema.String });
export type GitCredential = typeof GitCredential.Type;
export const GitCredentialList = Schema.Struct({ credentials: Schema.Array(GitCredentialRecord) });
