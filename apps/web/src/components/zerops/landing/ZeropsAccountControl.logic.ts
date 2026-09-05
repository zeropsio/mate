/**
 * What the bar shows for the signed-in person, derived once from the Zerops
 * user record (`GET /user/info`): a short name to say, initials to fall back
 * on, and the picture when the account has one.
 */

import type { ZeropsUser } from "@t3tools/client-runtime/zerops";

export interface ZeropsAccountDisplay {
  /** What the trigger says: the first name, else the full name's first word, else the email's local part. */
  readonly name: string;
  readonly fullName: string | null;
  readonly email: string | null;
  /** One or two letters standing in for the picture. */
  readonly initials: string;
  readonly avatarUrl: string | null;
}

type ZeropsAccountSource = Pick<
  ZeropsUser,
  "avatar" | "email" | "firstName" | "fullName" | "lastName"
>;

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : null;
}

function firstLetter(word: string): string {
  return [...word][0]?.toLocaleUpperCase() ?? "";
}

/** The first letters of the first and last word; one letter for one word. */
export function zeropsInitials(source: string): string {
  const words = source.split(/\s+/u).filter((word) => word.length > 0);
  const first = words[0];
  const last = words.at(-1);
  if (first === undefined) return "";
  return words.length > 1 && last !== undefined
    ? `${firstLetter(first)}${firstLetter(last)}`
    : firstLetter(first);
}

export function zeropsAccountDisplay(user: ZeropsAccountSource | null): ZeropsAccountDisplay {
  const email = text(user?.email);
  const firstName = text(user?.firstName);
  const lastName = text(user?.lastName);
  const joined = [firstName, lastName].filter((part) => part !== null).join(" ");
  const fullName = text(user?.fullName) ?? text(joined);
  const localPart = email === null ? null : text(email.split("@")[0]);
  const firstWord = fullName === null ? null : text(fullName.split(/\s+/u)[0]);
  const name = firstName ?? firstWord ?? localPart ?? "Account";
  const avatar = user?.avatar;
  return {
    name,
    fullName,
    email,
    initials: zeropsInitials(fullName ?? name),
    avatarUrl:
      text(avatar?.smallAvatarUrl) ??
      text(avatar?.externalAvatarUrl) ??
      text(avatar?.largeAvatarUrl),
  };
}
