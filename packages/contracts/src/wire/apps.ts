/** Repository name shared by HQ's application and plain-project wire. */
import * as Schema from "effect/Schema";

export const RepositoryName = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u),
);
