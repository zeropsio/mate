import * as NodeOS from "node:os";

import { QrCode } from "@t3tools/shared/qrCode";
import * as Effect from "effect/Effect";
import { HttpServer } from "effect/unstable/http";

import { ServerConfig, type StartupPresentation } from "./config.ts";
import type { ZeropsEnvironment } from "./zerops/ZeropsEnvironment.ts";
import * as EnvironmentAuth from "./auth/EnvironmentAuth.ts";
import { withBasePath } from "@t3tools/shared/basePath";

export interface HeadlessServeAccessInfo {
  readonly connectionString: string;
  readonly token: string;
  readonly pairingUrl: string;
}

type NetworkInterfacesMap = ReturnType<typeof NodeOS.networkInterfaces>;

export const isLoopbackHost = (host: string | undefined): boolean => {
  if (!host || host.length === 0) {
    return true;
  }

  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    host.startsWith("127.")
  );
};

export const isWildcardHost = (host: string | undefined): boolean =>
  host === "0.0.0.0" || host === "::" || host === "[::]";

export const formatHostForUrl = (host: string): string =>
  host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;

const normalizeHost = (host: string): string =>
  host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;

const isIpv4Family = (family: string | number): boolean => family === "IPv4" || family === 4;

const isIpv6Family = (family: string | number): boolean => family === "IPv6" || family === 6;

export const resolveHeadlessConnectionHost = (
  host: string | undefined,
  interfaces: NetworkInterfacesMap = NodeOS.networkInterfaces(),
): string => {
  if (!host) {
    return "localhost";
  }

  if (!isWildcardHost(host)) {
    return normalizeHost(host);
  }

  const interfaceEntries = Object.values(interfaces).flatMap((entries) => entries ?? []);
  const externalIpv4 = interfaceEntries.find(
    (entry) => !entry.internal && isIpv4Family(entry.family),
  );
  if (externalIpv4) {
    return externalIpv4.address;
  }

  const externalIpv6 = interfaceEntries.find(
    (entry) => !entry.internal && isIpv6Family(entry.family),
  );
  return externalIpv6 ? normalizeHost(externalIpv6.address) : "localhost";
};

export const resolveHeadlessConnectionString = (
  host: string | undefined,
  port: number,
  interfaces: NetworkInterfacesMap = NodeOS.networkInterfaces(),
): string => {
  const connectionHost = resolveHeadlessConnectionHost(host, interfaces);
  return `http://${formatHostForUrl(connectionHost)}:${port}`;
};

export const resolveListeningPort = (address: unknown, fallbackPort: number): number => {
  if (
    typeof address === "object" &&
    address !== null &&
    "port" in address &&
    typeof address.port === "number"
  ) {
    return address.port;
  }
  return fallbackPort;
};

export const buildPairingUrl = (connectionString: string, token: string): string => {
  // The connection string may carry the prefix the server is published under,
  // and the pair route lives below it.
  const url = new URL(withBasePath(connectionString, "/pair"));
  url.searchParams.delete("token");
  url.hash = new URLSearchParams([["token", token]]).toString();
  return url.toString();
};

export const renderTerminalQrCode = (value: string, margin = 2): string => {
  const qrCode = QrCode.encodeText(value, QrCode.Ecc.MEDIUM);
  const rows: Array<string> = [];
  const isDark = (x: number, y: number): boolean =>
    x >= 0 && x < qrCode.size && y >= 0 && y < qrCode.size && qrCode.getModule(x, y);

  for (let y = -margin; y < qrCode.size + margin; y += 2) {
    let row = "";

    for (let x = -margin; x < qrCode.size + margin; x += 1) {
      const topDark = isDark(x, y);
      const bottomDark = isDark(x, y + 1);

      row += topDark ? (bottomDark ? "█" : "▀") : bottomDark ? "▄" : " ";
    }

    rows.push(row);
  }

  return rows.join("\n");
};

export const formatHeadlessServeOutput = (accessInfo: HeadlessServeAccessInfo): string =>
  [
    "T3 Code server is ready.",
    `Connection string: ${accessInfo.connectionString}`,
    `Token: ${accessInfo.token}`,
    `Pairing URL: ${accessInfo.pairingUrl}`,
    "",
    renderTerminalQrCode(accessInfo.pairingUrl),
    "",
  ].join("\n");

/**
 * Which of the three things a boot announces.
 *
 * Upstream has two, and both mint an `administrative-bootstrap` pairing
 * credential with administrative scopes: `headless` prints it, `browser` turns
 * it into a `/pair#token=` link. Whoever can read the process output therefore
 * gets an admin credential on every boot - survivable when the reader is the
 * person who started the server on their own machine, not when the process is
 * a supervised unit in a container whose logs are an operations surface.
 *
 * Inside a Zerops project neither path runs. Nothing is minted at boot at all:
 * the way in is the identity door, where the caller proves who they are.
 */
export type StartupAccessMode = "zerops" | "headless" | "browser";

export const resolveStartupAccessMode = (config: {
  readonly zerops: ZeropsEnvironment | undefined;
  readonly startupPresentation: StartupPresentation;
}): StartupAccessMode =>
  config.zerops !== undefined
    ? "zerops"
    : config.startupPresentation === "headless"
      ? "headless"
      : "browser";

/** What a Zerops container prints in place of a credential. */
export const formatZeropsServeOutput = (connectionString: string): string =>
  [
    "Zerops Mate is ready.",
    `Address: ${connectionString}`,
    "Sign in with your Zerops account - members of this project are let in by",
    "their Zerops identity, so no pairing code is issued here.",
    "",
  ].join("\n");

/** The address this server answers on, without minting anything. */
export const resolveServeConnectionString = Effect.fn("resolveServeConnectionString")(function* () {
  const serverConfig = yield* ServerConfig;
  const httpServer = yield* HttpServer.HttpServer;
  return resolveHeadlessConnectionString(
    serverConfig.host,
    resolveListeningPort(httpServer.address, serverConfig.port),
  );
});

export const issueHeadlessServeAccessInfo = Effect.fn("issueHeadlessServeAccessInfo")(function* () {
  const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
  const connectionString = yield* resolveServeConnectionString();
  const issued = yield* serverAuth.issueStartupPairingCredential();

  return {
    connectionString,
    token: issued.credential,
    pairingUrl: buildPairingUrl(connectionString, issued.credential),
  } satisfies HeadlessServeAccessInfo;
});
