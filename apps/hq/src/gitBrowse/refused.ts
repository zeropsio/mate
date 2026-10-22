/**
 * What a browse read refuses beside the changes' own refusals (`ChangeRefused`): a path the commit
 * does not hold (`404`), a folder asked as a file (`404 not_a_file`: the page opens the folder), or
 * a file past a read's ceiling (`413`, with the ceiling and its size).
 *
 * @module gitBrowse/refused
 */
import * as Schema from "effect/Schema";

export class BrowseRefused extends Schema.TaggedError<BrowseRefused>()("BrowseRefused", {
  code: Schema.Literals(["path_not_found", "not_a_file", "too_large"]),
  limit: Schema.optionalKey(Schema.Int),
  size: Schema.optionalKey(Schema.Int),
}) {}
