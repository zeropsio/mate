/**
 * The settings for automated Mates, read and written through the account (`makeAutomationSettings`):
 * the organization's API keys, and an application's intake. A screen demands what it shows, and an
 * intake's answer — a secret to paste — lives only while the screen that set it stays open.
 */
import {
  appIntake,
  makeAutomationSettings,
  orgAiKeys,
  type AccountStore,
  type AppIntakeRead,
  type OrgAiKeysRead,
} from "@t3tools/client-runtime/data";
import type { HqApi } from "@t3tools/client-runtime/zerops/hq";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useEffect, useMemo } from "react";

import { randomUUID } from "../lib/utils";
import { automatedKeyState, type AutomatedKeyState } from "./automatedMate.logic";
import { useOfficialHq } from "./accountHq";
import { onAccountLifetimeClose } from "./accountLifetime";
import { useAccountOrgId, useAccountStoreForAdapters, useProjection } from "./ZeropsAccountData";

const hosts = new WeakMap<
  AccountStore,
  WeakMap<HqApi, ReturnType<typeof makeAutomationSettings>>
>();
function hostFor(store: AccountStore, api: HqApi) {
  let byApi = hosts.get(store);
  if (byApi === undefined) {
    byApi = new WeakMap();
    hosts.set(store, byApi);
  }
  let host = byApi.get(api);
  if (host === undefined) {
    host = makeAutomationSettings({ store, api, makeId: randomUUID });
    byApi.set(api, host);
    onAccountLifetimeClose(host.close);
  }
  return host;
}

const KEYS_UNREAD = Atom.make<OrgAiKeysRead>({
  keys: { state: "unread" },
  action: { kind: "idle" },
});
const INTAKE_UNREAD = Atom.make<AppIntakeRead>({
  intake: undefined,
  action: { kind: "idle" },
  answer: null,
});

function useHost() {
  const hq = useOfficialHq();
  const store = useAccountStoreForAdapters();
  const orgId = useAccountOrgId();
  const host = hq === null || store === null ? null : hostFor(store, hq.api);
  return { host, store, orgId };
}

/** The organization's API keys, read while `shown`; set, replaced and removed from here. */
export function useOrgAiKeys(shown: boolean) {
  const { host, store, orgId } = useHost();
  const key = useMemo(() => (orgId === null ? null : { orgId }), [orgId]);
  const read = useAtomValue(
    store === null || key === null ? KEYS_UNREAD : store.data.project(orgAiKeys, key),
  );
  useEffect(() => {
    if (shown && host !== null && key !== null) return host.demandKeys(key);
  }, [host, key, shown]);
  return {
    read,
    setKey: (provider: string, value: string) => {
      if (host !== null && key !== null) void host.setKey(key, provider, value);
    },
    removeKey: (provider: string) => {
      if (host !== null && key !== null) void host.removeKey(key, provider);
    },
    again: () => {
      if (host !== null && key !== null) host.againKeys(key);
    },
  };
}

/** An application's intake, held while its screen is open: what HQ answered from here stays. */
export function useAppIntake(appId: string) {
  const { host, store, orgId } = useHost();
  const key = useMemo(() => (orgId === null ? null : { orgId, appId }), [orgId, appId]);
  const read = useAtomValue(
    store === null || key === null ? INTAKE_UNREAD : store.data.project(appIntake, key),
  );
  useEffect(() => {
    if (host !== null && key !== null) return host.holdIntake(key);
  }, [host, key]);
  return {
    read,
    set: (repo: string, label: string) => {
      if (host !== null && key !== null) void host.setIntake(key, repo, label);
    },
    stop: () => {
      if (host !== null && key !== null) void host.stopIntake(key);
    },
  };
}

/**
 * Whether the organization holds the key its automated Mates run on, as read for the account
 * (`automatedKeyState`). The read is held from the app's root while signed in
 * (`useHoldAutomatedKey`), once a session, so New Mate and every automated Mate's row find it
 * read rather than learning it after they paint.
 */
export function useAutomatedKey(): AutomatedKeyState {
  const orgId = useAccountOrgId();
  const key = useMemo(() => (orgId === null ? null : { orgId }), [orgId]);
  return automatedKeyState(useProjection(orgAiKeys, key, KEYS_UNREAD).keys);
}

/** Holds the organization's keys read while the account is signed in (the app's root). */
export function useHoldAutomatedKey(): void {
  useOrgAiKeys(true);
}
