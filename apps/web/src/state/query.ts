import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

const EMPTY_ASYNC_RESULT_ATOM = Atom.make(AsyncResult.initial<never, never>(false)).pipe(
  Atom.withLabel("web-environment-query:empty"),
);

export interface EnvironmentQueryView<A> {
  readonly data: A | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly refresh: () => void;
}

export function formatEnvironmentQueryError(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  return typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim().length > 0
    ? error.message
    : "The environment request failed.";
}

export function useEnvironmentQuery<A, E>(
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>> | null,
): EnvironmentQueryView<A> {
  const selectedAtom = atom ?? EMPTY_ASYNC_RESULT_ATOM;
  const result = useAtomValue(selectedAtom);
  const refresh = useAtomRefresh(selectedAtom);
  return {
    data: Option.getOrNull(AsyncResult.value(result)),
    error: result._tag === "Failure" ? formatEnvironmentQueryError(result.cause) : null,
    isPending: atom !== null && result.waiting,
    refresh,
  };
}

export type CollectionReadState = "ready" | "failed" | "loading" | "unavailable";

export interface CollectionPresentation<A> {
  readonly state: CollectionReadState;
  readonly items: ReadonlyArray<A>;
  readonly message: string | null;
  readonly retained: boolean;
}

/** Only a settled successful read can prove an empty collection. */
export function collectionPresentation<A, Item>(
  query: Pick<EnvironmentQueryView<A>, "data" | "error" | "isPending">,
  select: (data: A) => ReadonlyArray<Item>,
  labels: { readonly loading: string; readonly unavailable: string },
  responseError: string | null = null,
): CollectionPresentation<Item> {
  const error = query.error ?? responseError;
  const state: CollectionReadState =
    error !== null
      ? "failed"
      : query.isPending
        ? "loading"
        : query.data === null
          ? "unavailable"
          : "ready";
  return {
    state,
    items: query.data === null ? [] : select(query.data),
    message:
      state === "failed"
        ? error
        : state === "loading"
          ? labels.loading
          : state === "unavailable"
            ? labels.unavailable
            : null,
    retained: query.data !== null && state !== "ready",
  };
}
