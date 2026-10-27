// @effect-diagnostics globalFetch:off -- This browser transport supplies the HQ client's native fetch port.
/** Browser transport for the account's shared HQ adapter and its operation executor. */
import { makeHqApi, type OpenHqSocket } from "../../zerops/hq/index.ts";
const openHqSocket: OpenHqSocket = (url, on) => {
  const socket = new WebSocket(url);
  socket.addEventListener("open", () => on.open());
  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string") on.message(event.data);
  });
  socket.addEventListener("close", (event) => on.close(event.code));
  return {
    // Sent only once open (the wire begins its segment then); what is sent to a socket already
    // closing is lost with it.
    send: (data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(data);
    },
    close: () => socket.close(),
  };
};

export const makeBrowserHqApi = (
  options: Omit<Parameters<typeof makeHqApi>[0], "fetch" | "openSocket">,
) =>
  makeHqApi({
    ...options,
    fetch: (input, init) => fetch(input, init),
    openSocket: openHqSocket,
  });
