import {
  AuthAccessStreamError,
  type AuthAccessStreamEvent,
  type AuthSessionId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import type { EnvironmentAuth } from "./EnvironmentAuth.ts";
import type * as PairingGrantStore from "./PairingGrantStore.ts";
import type * as SessionStore from "./SessionStore.ts";

function toAuthAccessStreamEvent(
  change: PairingGrantStore.BootstrapCredentialChange | SessionStore.SessionCredentialChange,
  revision: number,
  currentSessionId: AuthSessionId,
): AuthAccessStreamEvent {
  switch (change.type) {
    case "pairingLinkUpserted":
      return {
        version: 1,
        revision,
        type: "pairingLinkUpserted",
        payload: change.pairingLink,
      };
    case "pairingLinkRemoved":
      return {
        version: 1,
        revision,
        type: "pairingLinkRemoved",
        payload: { id: change.id },
      };
    case "clientUpserted":
      return {
        version: 1,
        revision,
        type: "clientUpserted",
        payload: {
          ...change.clientSession,
          current: change.clientSession.sessionId === currentSessionId,
        },
      };
    case "clientRemoved":
      return {
        version: 1,
        revision,
        type: "clientRemoved",
        payload: { sessionId: change.sessionId },
      };
  }
}

interface AuthAccessStreamDeps {
  readonly serverAuth: EnvironmentAuth["Service"];
  readonly bootstrapCredentials: Option.Option<PairingGrantStore.PairingGrantStore["Service"]>;
  readonly sessions: Option.Option<SessionStore.SessionStore["Service"]>;
  readonly currentSessionId: AuthSessionId;
}

export const authAccessStream = ({
  serverAuth,
  bootstrapCredentials,
  sessions,
  currentSessionId,
}: AuthAccessStreamDeps) => {
  const loadAuthAccessSnapshot = () =>
    Effect.all({
      pairingLinks: serverAuth.listPairingLinks(),
      clientSessions: serverAuth.listClientSessions(currentSessionId),
    }).pipe(
      Effect.mapError(
        (error) =>
          new AuthAccessStreamError({
            message: error.message,
          }),
      ),
    );

  return Stream.unwrap(
    Effect.gen(function* () {
      const initialSnapshot = yield* loadAuthAccessSnapshot();
      const revisionRef = yield* Ref.make(1);
      const accessChanges: Stream.Stream<
        PairingGrantStore.BootstrapCredentialChange | SessionStore.SessionCredentialChange
      > = Stream.merge(
        Option.isSome(bootstrapCredentials)
          ? bootstrapCredentials.value.streamChanges
          : Stream.empty,
        Option.isSome(sessions) ? sessions.value.streamChanges : Stream.empty,
      );

      const liveEvents: Stream.Stream<AuthAccessStreamEvent> = accessChanges.pipe(
        Stream.mapEffect((change) =>
          Ref.updateAndGet(revisionRef, (revision) => revision + 1).pipe(
            Effect.map((revision) => toAuthAccessStreamEvent(change, revision, currentSessionId)),
          ),
        ),
      );

      return Stream.concat(
        Stream.make({
          version: 1 as const,
          revision: 1,
          type: "snapshot" as const,
          payload: initialSnapshot,
        }),
        liveEvents,
      );
    }),
  );
};
