/**
 * What this browser keeps of inviting people, account-scoped, never a source's answer:
 *
 * - The names an inviter typed, by organization and address, until those people join. Zerops lists
 *   an invitation not joined yet by its address alone (measured 2026-10-15: names fill in once the
 *   person joins) and HQ keeps no record of people, so the typed name is the inviter's own words,
 *   shown in place of the address; a member's own name always wins once Zerops has one.
 * - Whether the person was welcomed to an organization: the arrival line is said once, on the
 *   first visit, and later visits are quiet.
 */
import * as Schema from "effect/Schema";

import { accountLocalStorage } from "./accountLifetime";

const NAMES_KEY = "mate:invited-names";
const WELCOMED_KEY = "mate:welcomed-organizations";

const Names = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.String)),
);
const decodeNames = Schema.decodeUnknownSync(Names);
const encodeNames = Schema.encodeSync(Names);
const Welcomed = Schema.fromJsonString(Schema.Array(Schema.String));
const decodeWelcomed = Schema.decodeUnknownSync(Welcomed);
const encodeWelcomed = Schema.encodeSync(Welcomed);

const readNames = () => {
  try {
    return decodeNames(accountLocalStorage.getItem(NAMES_KEY) ?? "{}");
  } catch {
    return {};
  }
};

const addressKey = (email: string) => email.trim().toLocaleLowerCase();

/** The names typed for `orgId`'s invitations, by address in lower case. */
export function invitedNames(orgId: string): Readonly<Record<string, string>> {
  return readNames()[orgId] ?? {};
}

/** Keeps the name typed for an invitation sent to `email`. */
export function rememberInvitedName(orgId: string, email: string, name: string): void {
  const typed = name.trim();
  if (typed === "") return;
  const held = readNames();
  try {
    accountLocalStorage.setItem(
      NAMES_KEY,
      encodeNames({ ...held, [orgId]: { ...held[orgId], [addressKey(email)]: typed } }),
    );
  } catch {
    /* Blocked storage leaves the address in its place. */
  }
}

const readWelcomed = (): ReadonlyArray<string> => {
  try {
    return decodeWelcomed(accountLocalStorage.getItem(WELCOMED_KEY) ?? "[]");
  } catch {
    return [];
  }
};

/** Whether this person was already welcomed to `orgId`. */
export function wasWelcomed(orgId: string): boolean {
  return readWelcomed().includes(orgId);
}

/** Notes that the welcome to `orgId` was decided: shown once, or not owed. */
export function markWelcomed(orgId: string): void {
  const held = readWelcomed();
  if (held.includes(orgId)) return;
  try {
    accountLocalStorage.setItem(WELCOMED_KEY, encodeWelcomed([...held, orgId]));
  } catch {
    /* Blocked storage says the welcome again next time. */
  }
}
