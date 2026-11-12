/**
 * Whether a project's production is deployed outside Mate and follows `main`, as somebody said in
 * HQ: who may say so (whoever HQ's structure verb lets: an Owner or Admin), and the one write that
 * says it, changes its address or takes it back (`set-outside-production`). What the page draws of
 * it comes from the project's flow (`GroupFlowProduction`'s `outside`); this holds only the press.
 * An HQ older than the statement is learned from that write alone.
 */
import {
  OUTSIDE_PRODUCTION_UNSUPPORTED,
  OperationStopped,
  sameOutsideProduction,
  type OutsideProduction,
} from "@t3tools/client-runtime/data";
import { hqOffer } from "@t3tools/shared/hqOffers";
import { useEffect, useState } from "react";

import { useAccountOrgId } from "./accountData";
import { useAccountOperationsOptional } from "./accountOperations";
import { useHqStructure } from "./useHqOffers";

/** Save or Stop following main, as pressed: under way, or refused in plain words. */
export type OutsidePress =
  | { readonly kind: "idle" }
  | { readonly kind: "saving"; readonly lifting: boolean }
  | { readonly kind: "refused"; readonly words: string };

export interface AppOutsideProduction {
  /** HQ is older than the statement: its form says so, and changes nothing. */
  readonly older: boolean;
  /** Whether the person says or changes it; `undefined` while their role is not read. */
  readonly editable: boolean | undefined;
  readonly press: OutsidePress;
  /**
   * Says production follows `main` at `outside.address`, or — `null` — takes it back; `onSaved`
   * once HQ took it. Absent outside an account.
   */
  readonly save: ((outside: OutsideProduction | null, onSaved: () => void) => void) | undefined;
  /** Forgets a refusal: the form was closed, and opens clean. */
  readonly reset: () => void;
}

const IDLE: OutsidePress = { kind: "idle" };

/** How long a statement HQ took waits for HQ's navigation to say it before its form closes anyway. */
const SHOWN_WITHIN_MS = 8_000;

type Held = OutsideProduction | null;

export function useAppOutsideProduction(appId: string): AppOutsideProduction {
  const app = useHqStructure()?.apps.find((candidate) => candidate.id === appId);
  const offer = hqOffer(app?.can, "structure");
  const operations = useAccountOperationsOptional();
  const orgId = useAccountOrgId();
  const [press, setPress] = useState(IDLE);
  const [older, setOlder] = useState(false);
  // What HQ took, until its navigation says it: the page is drawn from the navigation alone, so
  // the form stays as it is until the page under it has changed.
  const [taken, setTaken] = useState<{
    readonly over: Held;
    readonly now: Held;
    readonly onSaved: () => void;
  } | null>(null);
  const held: Held | undefined =
    app === undefined
      ? undefined
      : app.outsideProduction === undefined
        ? null
        : { address: app.outsideProduction.address };
  const shown =
    taken !== null &&
    held !== undefined &&
    (sameOutsideProduction(held, taken.now) || !sameOutsideProduction(held, taken.over));
  useEffect(() => {
    if (taken === null) return;
    const finish = () => {
      setTaken(null);
      setPress(IDLE);
      taken.onSaved();
    };
    if (shown) {
      finish();
      return;
    }
    const timer = setTimeout(finish, SHOWN_WITHIN_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [shown, taken]);
  const save = (outside: Held, onSaved: () => void) => {
    if (operations === null || orgId === null || held === undefined) return;
    setPress({ kind: "saving", lifting: outside === null });
    operations
      .run(
        { kind: "set-outside-production", orgId, appId, outside },
        { orgId, unobserved: "HQ isn't answering. Check Production here when it returns." },
      )
      .then(
        (result) => {
          setTaken({ over: held, now: result.outside, onSaved });
        },
        (cause: unknown) => {
          if (cause instanceof OperationStopped && cause.code === OUTSIDE_PRODUCTION_UNSUPPORTED) {
            setOlder(true);
            setPress(IDLE);
            return;
          }
          setPress({
            kind: "refused",
            words: cause instanceof Error ? cause.message : "HQ did not take this change.",
          });
        },
      );
  };
  return {
    older,
    editable: offer.kind === "unknown" ? undefined : offer.kind === "allowed",
    press,
    save: operations === null || orgId === null ? undefined : save,
    reset: () => {
      setPress((now) => (now.kind === "refused" ? IDLE : now));
    },
  };
}
