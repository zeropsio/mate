import { useAtomValue } from "@effect/atom-react";
import { makeMateImages, makeMateImageWire, type AccountStore } from "@t3tools/client-runtime/data";
import { ManagedRelay } from "@t3tools/client-runtime/relay";
import { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AsyncResult, type AtomRegistry } from "effect/unstable/reactivity";
import { useEffect, useMemo, type ReactNode } from "react";
import { connectionAtomRuntime } from "../../connection/runtime";
import { MateImagesContext } from "../../assets/MateImages";

const wireAtom = connectionAtomRuntime.atom(
  Effect.gen(function* () {
    return makeMateImageWire(
      yield* EnvironmentRegistry,
      yield* Effect.serviceOption(ManagedRelay.ManagedRelayDpopSigner),
    );
  }),
);

export function MateImages({
  store,
  registry,
  children,
}: {
  readonly store: AccountStore;
  readonly registry: AtomRegistry.AtomRegistry;
  readonly children: ReactNode;
}) {
  const wire = Option.getOrNull(AsyncResult.value(useAtomValue(wireAtom)));
  const images = useMemo(
    () => (wire === null ? null : makeMateImages({ store, wire })),
    [store, wire],
  );
  useEffect(() => () => images?.stop(), [images]);
  const value = useMemo(
    () => (images === null ? null : { data: store.data, registry, images }),
    [images, store, registry],
  );
  return <MateImagesContext value={value}>{children}</MateImagesContext>;
}
