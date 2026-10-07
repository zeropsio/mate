// @effect-diagnostics globalFetch:off -- This browser transport supplies the HQ client's native fetch port.
/** Browser transport for the account's shared HQ adapter and its operation executor. */
import { makeHqApi, readHqHealth, type OpenHqSocket } from "../../zerops/hq/index.ts";
const openHqSocket: OpenHqSocket = (url, on) => {
  const socket = new WebSocket(url);
  /** What was sent before the socket opened: the scope requests, sent as soon as it does. */
  const early: string[] = [];
  socket.addEventListener("open", () => {
    for (const data of early.splice(0)) socket.send(data);
  });
  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string") on.message(event.data);
  });
  socket.addEventListener("close", (event) => on.close(event.code));
  return {
    // What is sent to a socket already closing is lost with it.
    send: (data) => {
      if (socket.readyState === WebSocket.CONNECTING) early.push(data);
      else if (socket.readyState === WebSocket.OPEN) socket.send(data);
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
export const readAccountHqHealth = (address: string) =>
  readHqHealth((input, init) => fetch(input, init), address);
