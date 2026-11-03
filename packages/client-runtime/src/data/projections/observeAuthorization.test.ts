import { describe, expect, it } from "vite-plus/test";
import type { ObserveCredentialRead } from "./observeCredential.ts";
import { authorizesObserveByItself, offersObserveAuthorize } from "./observeAuthorization.ts";

const NONE = { authorized: false, userId: null, expiresAt: null };
const AUTH = { authorized: true, userId: "person", expiresAt: "2026-11-28T10:00:00Z" };
const known = (value: typeof NONE | typeof AUTH, stale = false) =>
  ({ state: "known", value, stale }) satisfies ObserveCredentialRead["metadata"];

describe("a Mate's own person opening it", () => {
  it.each([
    {
      label: "their own Mate that is not authorized",
      mine: true,
      metadata: known(NONE),
      asked: false,
      runs: true,
    },
    {
      label: "their own Mate already authorized",
      mine: true,
      metadata: known(AUTH),
      asked: false,
      runs: false,
    },
    {
      label: "a last known state of not authorized",
      mine: true,
      metadata: known(NONE, true),
      asked: false,
      runs: false,
    },
    {
      label: "an authorization not read yet",
      mine: true,
      metadata: { state: "reading" },
      asked: false,
      runs: false,
    },
    {
      label: "an authorization they cannot read",
      mine: true,
      metadata: { state: "withheld" },
      asked: false,
      runs: false,
    },
    {
      label: "a failed read",
      mine: true,
      metadata: { state: "failed", words: "HQ isn't answering." },
      asked: false,
      runs: false,
    },
    { label: "a colleague's Mate", mine: false, metadata: known(NONE), asked: false, runs: false },
    {
      label: "a Mate HQ names no person of yet",
      mine: undefined,
      metadata: known(NONE),
      asked: false,
      runs: false,
    },
    {
      label: "a Mate already asked for this session",
      mine: true,
      metadata: known(NONE),
      asked: true,
      runs: false,
    },
  ] satisfies ReadonlyArray<{
    label: string;
    mine: boolean | undefined;
    metadata: ObserveCredentialRead["metadata"];
    asked: boolean;
    runs: boolean;
  }>)(
    "authorizes observation by itself only for $label: $runs",
    ({ mine, metadata, asked, runs }) => {
      expect(authorizesObserveByItself({ mine, metadata, asked })).toBe(runs);
    },
  );
});

describe("a Mate's observation section", () => {
  it.each([
    {
      label: "who may operate a Mate that is not authorized",
      mayWrite: true,
      metadata: known(NONE),
      offers: true,
    },
    {
      label: "who may operate a Mate last known not authorized",
      mayWrite: true,
      metadata: known(NONE, true),
      offers: true,
    },
    {
      label: "who may operate an authorized Mate",
      mayWrite: true,
      metadata: known(AUTH),
      offers: false,
    },
    {
      label: "who may operate a Mate whose authorization is being read",
      mayWrite: true,
      metadata: { state: "reading" },
      offers: false,
    },
    {
      label: "who may not operate the Mate",
      mayWrite: false,
      metadata: known(NONE),
      offers: false,
    },
    {
      label: "HQ says nothing of operating",
      mayWrite: undefined,
      metadata: known(NONE),
      offers: false,
    },
  ] satisfies ReadonlyArray<{
    label: string;
    mayWrite: boolean | undefined;
    metadata: ObserveCredentialRead["metadata"];
    offers: boolean;
  }>)("offers Authorize to a viewer $label: $offers", ({ mayWrite, metadata, offers }) => {
    expect(offersObserveAuthorize({ mayWrite, metadata })).toBe(offers);
  });
});
