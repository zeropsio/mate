import * as NodeHttpServerRequest from "@effect/platform-node/NodeHttpServerRequest";
import * as Effect from "effect/Effect";
import * as References from "effect/References";
import type * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as Socket from "effect/socket/Socket";

/** The platform upgrades lazily, when its reader is acquired, after HQ's authorization reads. */
export const upgradeSocket = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.map(request.upgrade, (socket) =>
    Socket.make({
      reader: Effect.suspend(() => {
        const transport = NodeHttpServerRequest.toIncomingMessage(request).socket;
        // ws skips the upgrade callback after a peer's FIN. The platform masks that acquisition,
        // so entering it on a dead transport would leave an uninterruptible request in Core's scope.
        if (!transport.readable || !transport.writable) return Effect.interrupt;
        return socket.reader;
      }).pipe(
        // Node's handshake is synchronous. Keep the liveness check and acquisition in one turn;
        // a scheduler yield between them could admit a FIN after the check. Reads yield normally.
        Effect.provideService(References.PreventSchedulerYield, true),
      ),
      writer: socket.writer,
    }),
  );
