// @effect-diagnostics nodeBuiltinImport:off -- A source guard reads authored files directly.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  AuthZeropsClientScopes,
  ORCHESTRATION_WS_METHODS,
  WS_METHODS,
  type AuthEnvironmentScope,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { zeropsGrantScopes } from "../zerops/ZeropsIdentityGate.ts";
import { RPC_REQUIRED_SCOPES } from "./RpcAuthorization.ts";

/**
 * The class of bug: a client invokes an RPC whose scope it never asked for.
 *
 * `zerops.mate.update` was one instance — the web offered *Check for updates*
 * and *Update*, the server required `exec:operate`, and the web's exchange
 * requested the five standard scopes. Nothing typechecks that pairing: the
 * server's map is keyed by wire method and the client's request is a list of
 * strings, and the two only meet at runtime, in a `403` on a button.
 *
 * So this walks the client sources for every RPC they name and checks it
 * against the scopes they ask for. It reads the authored files rather than
 * importing them: a web module drags the browser runtime in, and the question
 * — "which methods does this code mention?" — is a question about the text.
 */
const CLIENT_SOURCE_ROOTS = [
  "packages/client-runtime/src",
  "apps/web/src",
  "apps/mobile/src",
] as const;

const REPO_ROOT = new URL("../../../../", import.meta.url);

/**
 * Methods a client names but never reaches, each with the reason it is out of
 * scope rather than a bug. Every entry is re-checked below: one that stops
 * being referenced fails, so this cannot quietly rot into a list of excuses.
 */
const NOT_REACHED: Readonly<Record<string, string>> = {
  // Declared as an atom family in `client-runtime/state/auth.ts` and exported
  // by both shells, consumed by neither. An atom family subscribes when it is
  // mounted, so nothing opens this stream; access:read is administrative and
  // the Zerops door grants it to nobody.
  [WS_METHODS.subscribeAuthAccess]: "declared as an atom family, mounted nowhere",
  // A type-union member in `client-runtime/rpc/client.ts` naming which tags
  // stream; there is no call site.
  [WS_METHODS.cloudInstallRelayClient]: "named in a streaming-tag union, never called",
};

const METHOD_REFERENCE = /\b(ORCHESTRATION_WS_METHODS|WS_METHODS)\.([A-Za-z0-9_]+)/g;

function readSourceFiles(root: string): ReadonlyArray<{ path: string; text: string }> {
  const files: Array<{ path: string; text: string }> = [];
  const walk = (directory: string) => {
    for (const entry of NodeFS.readdirSync(directory, { withFileTypes: true })) {
      const full = NodePath.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/u.test(entry.name)) continue;
      // A test may name a method it never invokes in production.
      if (/\.(test|contract)\./u.test(entry.name)) continue;
      files.push({ path: full, text: NodeFS.readFileSync(full, "utf8") });
    }
  };
  walk(NodePath.join(NodeFS.realpathSync(REPO_ROOT), root));
  return files;
}

/** Every wire method the client sources name, and one file that names it. */
function referencedMethods(): ReadonlyMap<string, string> {
  const maps: Record<string, Readonly<Record<string, string>>> = {
    WS_METHODS,
    ORCHESTRATION_WS_METHODS,
  };
  const found = new Map<string, string>();
  for (const root of CLIENT_SOURCE_ROOTS) {
    for (const file of readSourceFiles(root)) {
      for (const match of file.text.matchAll(METHOD_REFERENCE)) {
        const method = maps[match[1]!]?.[match[2]!];
        if (method === undefined) continue;
        if (!found.has(method)) found.set(method, file.path);
      }
    }
  }
  return found;
}

const REFERENCED = referencedMethods();
const REQUESTED: ReadonlySet<AuthEnvironmentScope> = new Set(AuthZeropsClientScopes);

describe("the scopes a Mate client asks for", () => {
  it("finds the RPCs the clients name at all", () => {
    // A regex that matched nothing would make every assertion below vacuous.
    expect(REFERENCED.size).toBeGreaterThan(50);
    expect(REFERENCED.has(WS_METHODS.zeropsMateUpdate)).toBe(true);
    expect(REFERENCED.has(ORCHESTRATION_WS_METHODS.dispatchCommand)).toBe(true);
  });

  it.each(
    [...REFERENCED]
      .filter(([method]) => !(method in NOT_REACHED))
      .map(([method, path]) => [method, path] as const),
  )("%s is satisfiable by the scopes the client requests", (method, path) => {
    const required = RPC_REQUIRED_SCOPES[method as keyof typeof RPC_REQUIRED_SCOPES];
    expect(
      required,
      `${method} is named in ${path} but has no declared authorization scope`,
    ).toBeDefined();
    expect(
      REQUESTED.has(required),
      `${method} needs ${required}; the client asks for ${[...REQUESTED].join(" ")} (${path})`,
    ).toBe(true);
  });

  it.each(Object.entries(NOT_REACHED))(
    "%s is still named by a client, so its exemption is still about something",
    (method) => {
      expect(REFERENCED.has(method)).toBe(true);
    },
  );

  it("asks for exactly what the Zerops door grants", () => {
    // The exchange refuses a request for any scope the grant does not carry,
    // so one scope too many is no session at all.
    expect([...zeropsGrantScopes].sort()).toEqual([...AuthZeropsClientScopes].sort());
  });

  it("is what both shells actually put on the wire", () => {
    // The list above is only the real one if the connection layers name it.
    for (const source of [
      "apps/web/src/connection/platform.ts",
      "apps/mobile/src/connection/platform.ts",
    ]) {
      const text = NodeFS.readFileSync(
        NodePath.join(NodeFS.realpathSync(REPO_ROOT), source),
        "utf8",
      );
      expect(text, source).toContain("scopes: AuthZeropsClientScopes");
      expect(text, source).not.toContain("scopes: AuthStandardClientScopes");
    }
  });
});
