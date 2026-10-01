/**
 * The account's data runtime as far as its integration tokens go: the real cells and commands
 * over a platform whose tokens the test holds and may change between reads. Each live read of the
 * list and each write is recorded in `calls`, worded as the client fakes word them; a read of the
 * shared `tokens:{org}` cell is recorded as `shared tokens of {org}`.
 *
 * Lives outside `*.test.*` on purpose: it runs `Effect.runPromise`, which
 * `no-manual-effect-runtime-in-tests` forbids in test files.
 */
import type { ZeropsIntegrationToken, ZeropsProjectGrant } from "@t3tools/client-runtime/zerops";
import {
  AccountEpoch,
  makeZeropsApiOrigin,
  makeZeropsDataRuntime,
  ZeropsAccountId,
  ZeropsOrganizationId,
  type AccountScope,
  type ManagedZeropsDataRuntime,
  type OrganizationRef,
  type PlatformCommandReceipt,
  type TokensCellRequest,
} from "@t3tools/client-runtime/zerops/data";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/unstable/reactivity";

export interface TokenStore {
  readonly runtime: ManagedZeropsDataRuntime;
  readonly registry: AtomRegistry.AtomRegistry;
  readonly organization: OrganizationRef;
  readonly tokensRequest: TokensCellRequest;
  /** Ends the runtime. */
  readonly close: () => Promise<void>;
}

const metadataOf = (tokens: ReadonlyArray<ZeropsIntegrationToken>) =>
  tokens.map((token) => ({
    tokenId: token.id,
    name: token.name,
    grants: token.projects ?? [],
    ...(token.roleCode === undefined ? {} : { roleCode: token.roleCode }),
  }));

export async function makeTokenStore(input: {
  readonly calls: Array<string>;
  /** What the platform holds now; asked on every read. */
  readonly tokens: () => ReadonlyArray<ZeropsIntegrationToken>;
  /** Runs before the platform takes a project list write: a test holds a write open with it. */
  readonly beforeWrite?: () => Promise<void>;
  /** The platform taking a project list write. */
  readonly onWrite?: (write: {
    readonly tokenId: string;
    readonly projects: ReadonlyArray<ZeropsProjectGrant>;
  }) => void;
  readonly organizationId?: string;
}): Promise<TokenStore> {
  const scope: AccountScope = {
    account: {
      apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
      accountId: ZeropsAccountId.make("account"),
    },
    epoch: AccountEpoch.make(1),
  };
  const organization: OrganizationRef = {
    kind: "organization",
    account: scope.account,
    organizationId: ZeropsOrganizationId.make(input.organizationId ?? "org-1"),
  };
  const registry = AtomRegistry.make();
  let opaque = 0;
  const runtime = await Effect.runPromise(
    makeZeropsDataRuntime({
      scope,
      adapter: {
        openReceiver: () => Effect.never,
        register: () => Effect.never,
        read: () => Effect.never,
        closeReceiver: () => Effect.void,
        execute: (command) =>
          Effect.promise(async (): Promise<PlatformCommandReceipt> => {
            switch (command.kind) {
              case "list-integration-token-grants":
                input.calls.push(`list tokens of ${command.organization.organizationId}`);
                return {
                  processRefs: [],
                  observations: [],
                  result: { kind: command.kind, value: metadataOf(input.tokens()) },
                };
              case "set-integration-token-projects":
                await input.beforeWrite?.();
                input.onWrite?.(command);
                input.calls.push(
                  `grant ${command.projects.map((project) => project.projectId).join(",")} in ${command.organization.organizationId}${command.roleCode === undefined ? "" : ` as ${command.roleCode}`}`,
                );
                return {
                  processRefs: [],
                  observations: [],
                  result: { kind: command.kind, value: undefined },
                };
              default:
                throw new Error(`unexpected command ${command.kind}`);
            }
          }),
        cells: {
          readOrganizationIntegrationTokenGrants: (request) =>
            Effect.sync(() => {
              input.calls.push(`shared tokens of ${request.organization.organizationId}`);
              return metadataOf(input.tokens());
            }),
          readOrganizationLocations: () => Effect.die("tokens only"),
          readServiceAuthorizedAgents: () => Effect.die("tokens only"),
          readServiceMateFlag: () => Effect.die("tokens only"),
          readOrganizationMembers: () => Effect.die("tokens only"),
          readServiceVariableNames: () => Effect.die("tokens only"),
        },
      },
      atomRegistry: registry,
      makeOpaqueId: () => `opaque-${++opaque}`,
      initialAccess: {
        status: "verified",
        account: scope.account,
        accountEpoch: scope.epoch,
        verifiedAtMs: 0,
        deadlineMs: Number.MAX_SAFE_INTEGER,
        mutationsAllowed: true,
        organizations: [{ organization, mutationsAllowed: true }],
        projects: [],
      },
    }),
  );
  return {
    runtime,
    registry,
    organization,
    tokensRequest: { kind: "tokens", account: scope, organization },
    close: () =>
      Effect.runPromise(runtime.shutdown("application-close")).then(() => registry.dispose()),
  };
}
