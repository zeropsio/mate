import type { HqApi } from "../../zerops/hq/client.ts";
import {
  repoGovernanceId,
  repoGovernanceLink,
  repoGovernanceScope,
  repoGovernanceSubject,
} from "../families/hqRepoGovernance.ts";
import { sameValue } from "../projections/equal.ts";
import type { HqAppKey } from "../projections/hqAppDetail.ts";
import { rulesForSubject } from "../projections/hqRepoGovernance.ts";
import { readsOfState, type AccountStore } from "../store.ts";
import { makeSettingsReads, type SettingRead } from "./hqSettingsReads.ts";

export function makeRepoGovernance({
  store,
  api,
}: {
  readonly store: AccountStore;
  readonly api: Pick<HqApi, "appRepoGovernance">;
}) {
  const reads = makeSettingsReads(store);
  const spec = (key: HqAppKey): SettingRead<"hqRepoGovernance"> => ({
    family: "hqRepoGovernance",
    id: repoGovernanceId(key),
    scope: repoGovernanceScope(key),
    link: repoGovernanceLink(key),
    read: () => api.appRepoGovernance(key.appId),
  });
  let closed = false;
  const holders = new Map<string, { count: number; stop: () => void }>();
  return {
    demand(key: HqAppKey) {
      if (closed) return () => {};
      const setting = spec(key);
      let held = holders.get(setting.id);
      if (held === undefined) {
        const detailOf = (read: ReturnType<typeof readsOfState>) => {
          const fact = read.fact("hqAppDetail", `${key.appId}/repos`);
          return fact.kind === "known" ? fact.value : undefined;
        };
        let detail = detailOf(readsOfState(store.state()));
        let subject = repoGovernanceSubject(detail);
        const release = reads.demand(setting);
        const unsubscribe = store.subscribe(() => {
          const read = readsOfState(store.state());
          const next = detailOf(read);
          if (next === detail) return;
          detail = next;
          const previous = subject;
          subject = repoGovernanceSubject(detail);
          if (
            subject.length > 0 &&
            !sameValue(subject, previous) &&
            !rulesForSubject(read, key, subject).matches
          )
            reads.again(setting);
        });
        held = {
          count: 0,
          stop: () => {
            unsubscribe();
            release();
          },
        };
        holders.set(setting.id, held);
      }
      held.count++;
      let released = false;
      return () => {
        if (released || closed) return;
        released = true;
        if (--held.count === 0) {
          holders.delete(setting.id);
          held.stop();
        }
      };
    },
    again: (key: HqAppKey) => reads.again(spec(key)),
    close: () => {
      closed = true;
      for (const holder of holders.values()) holder.stop();
      holders.clear();
      reads.close();
    },
  };
}
