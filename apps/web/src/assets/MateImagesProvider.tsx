import { useAtomValue } from "@effect/atom-react";
import { makeMateImages, makeMateImageWire, type AccountStore } from "@t3tools/client-runtime/data";
import { ManagedRelay } from "@t3tools/client-runtime/relay";
import { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useMemo, type ReactNode } from "react";
import { connectionAtomRuntime } from "~/connection/runtime";
import { MateImagesContext } from "./MateImages";

const wireAtom = connectionAtomRuntime.atom(
  Effect.gen(function* () {
    return makeMateImageWire(
      yield* EnvironmentRegistry,
      yield* Effect.serviceOption(ManagedRelay.ManagedRelayDpopSigner),
    );
  }),
);
/** An account owns its demand and facts. A mounted presentation owns its Blob URL. */
export function MateImages({
  store,
  children,
}: {
  readonly store: AccountStore;
  readonly children: ReactNode;
}) {
  const wire = Option.getOrNull(AsyncResult.value(useAtomValue(wireAtom)));
  const images = useMemo(
    () => (wire === null ? null : makeMateImages({ store, wire, reuseRetained: true })),
    [store, wire],
  );
  useEffect(() => () => images?.stop(), [images]);
  const value = useMemo(() => (images === null ? null : { store, images }), [images, store]);
  return <MateImagesContext value={value}>{children}</MateImagesContext>;
}
