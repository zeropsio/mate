/**
 * What this browser keeps of the person's own *Put it live*, account-scoped, never a source's
 * answer: for each project, the production its run made, until that run went live or the person
 * put its card away. A run lives in the tab's memory (`putLive.ts`); this id alone lets a reload say
 * the attempt was this person's, and the project's flow says how it ended (`putLiveResumed`).
 */
import * as Schema from "effect/Schema";

import { accountLocalStorage } from "./accountLifetime";

const KEY = "mate:put-live-productions";
const Kept = Schema.fromJsonString(Schema.Record(Schema.String, Schema.String));
const decodeKept = Schema.decodeUnknownSync(Kept);
const encodeKept = Schema.encodeSync(Kept);

/** The production each project's *Put it live* made, by project. */
export function keptPutLiveProductions(): Readonly<Record<string, string>> {
  try {
    return decodeKept(accountLocalStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

function write(kept: Readonly<Record<string, string>>): void {
  try {
    if (Object.keys(kept).length === 0) accountLocalStorage.removeItem(KEY);
    else accountLocalStorage.setItem(KEY, encodeKept(kept));
  } catch {
    /* Blocked storage leaves a reload to the project's own Review release. */
  }
}

export function keepPutLiveProduction(groupId: string, productionId: string): void {
  const kept = keptPutLiveProductions();
  if (kept[groupId] !== productionId) write({ ...kept, [groupId]: productionId });
}

export function forgetPutLiveProduction(groupId: string): void {
  const { [groupId]: dropped, ...rest } = keptPutLiveProductions();
  if (dropped !== undefined) write(rest);
}
