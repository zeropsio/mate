/**
 * `storage`: a repository's Git storage cap and usage (`@t3tools/contracts` `HqRepoStorage`), at
 * `…/repos/:repo/storage` beside the browse reads. It moves with every push: read again on an
 * explicit ask or a new visit, and on a set of its cap from HQ's answer, never on a timer.
 *
 * @module zerops/gitBrowse/storage
 */
import { HqRepoStorage } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const storageRead = {
  query: Schema.Struct({}),
  value: HqRepoStorage,
  moving: true,
  path: "storage",
} as const;
