// @effect-diagnostics nodeBuiltinImport:off -- controlled native daemon boundary.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { WebSocketServer } from "ws";
import type { ZeropsBrowserFrame } from "@t3tools/contracts";
/** Native source facts are authored here, never inferred from a pending tool call by the transport. */
export async function scriptedBrowserSource(homeDir: string) {
  const directory = NodePath.join(homeDir, ".agent-browser");
  await NodeFSP.mkdir(directory, { recursive: true });
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (typeof address === "string" || address === null) throw new Error("Daemon has no port");
  const portFile = NodePath.join(directory, "default.stream");
  await NodeFSP.writeFile(portFile, String(address.port));
  const connected = new Promise<void>((resolve) => server.once("connection", () => resolve()));
  let seq = 0;
  const send = (message: unknown) => {
    for (const peer of server.clients) peer.send(JSON.stringify(message));
  };
  return {
    connected,
    frame: (frame: Omit<ZeropsBrowserFrame, "type">) =>
      send({
        type: "frame",
        seq: ++seq,
        data: frame.data,
        callId: frame.callId,
        threadId: frame.threadId,
        turnId: frame.turnId,
        revision: frame.revision,
        completeness: frame.completeness,
        metadata: {
          deviceWidth: frame.width,
          deviceHeight: frame.height,
          pageScaleFactor: frame.pageScaleFactor,
          scrollOffsetX: frame.scrollX,
          scrollOffsetY: frame.scrollY,
        },
      }),
    tabs: (tabs: ReadonlyArray<{ active: boolean; url: string; title: string; tabId: string }>) =>
      send({ type: "tabs", tabs }),
    close: async () => {
      for (const peer of server.clients) peer.terminate();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await NodeFSP.rm(portFile, { force: true });
    },
  };
}
