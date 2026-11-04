/**
 * A proposal: what a Zerops tool asks the person to approve. The Chief's organization tools
 * (`zerops_org_*`) propose changes to the organization; a project's Mate proposes asking the
 * person's Chief (`zerops_propose_ask_chief`), or connecting an MCP server for its agents
 * (`zerops_propose_mcp`). Those tools never act. Each returns one document
 * with a top-level `proposal`; the person approves or declines it on its card, and the client
 * carries out an approved one as the person. The contract is zcp's (`../zcp/docs/spec-mate.md`,
 * org mode).
 *
 * Only a whole proposal is read: a document whose proposal misses what its kind needs is no
 * proposal, and its call stays the plain row any tool's call is.
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** The organization's tools: they read freely and propose what they would change. */
export const ORG_TOOL_PREFIX = "zerops_org_";

/** Every Zerops tool: any of them may answer a proposal. */
const ZEROPS_TOOL_PREFIX = "zerops_";

export type ZeropsProposalKind =
  | "service.restart"
  | "service.start"
  | "service.stop"
  | "env.set"
  | "mate.message"
  | "chief.message"
  | "domain.add"
  | "access.set"
  | "mcp.add"
  | "env.reveal";

interface ProposalHead {
  readonly id: string;
  /** What it does, in one line: the card's title. */
  readonly summary: string;
  /** Why the Mate proposes it. */
  readonly reason?: string;
  readonly projectId?: string;
  readonly projectName?: string;
  readonly serviceId?: string;
  readonly serviceName?: string;
}

export interface ZeropsEnvProposalParams {
  readonly scope: "project" | "service";
  readonly key: string;
  readonly value: string;
  readonly secret: boolean;
}

export interface ZeropsMessageProposalParams {
  /** The Mate that receives it: its project, and its name there. */
  readonly to: { readonly projectId: string; readonly mateName: string };
  readonly words: string;
  /** Something handed along with the words, such as a log excerpt. */
  readonly attachment?: { readonly title: string; readonly text: string };
}

export interface ZeropsChiefMessageParams {
  readonly words: string;
  /** Something handed along with the words, such as a log excerpt. */
  readonly attachment?: { readonly title: string; readonly text: string };
}

export interface ZeropsDomainProposalParams {
  /** The domains, put on one routing: `shop.com` and `www.shop.com` answer alike. */
  readonly domains: ReadonlyArray<string>;
  /** The service's web port they point at. */
  readonly port: number;
}

/** The levels access gives on a project, as an application's People give them. */
export type ZeropsAccessLevel = "full" | "read" | "none" | "remove";

export interface ZeropsAccessProposalParams {
  /** Every project the access is written on: an application's production, stage and Mates. */
  readonly projects: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  /**
   * Each person as the person deciding named them — an address or a name — at their level: the
   * card finds them among the organization's members.
   */
  readonly people: ReadonlyArray<{ readonly person: string; readonly level: ZeropsAccessLevel }>;
}

/** Who an MCP server is proposed for: only `mate` is set up so far. */
export type ZeropsMcpScope = "mate" | "project" | "org";

export type ZeropsMcpTransport =
  | { readonly type: "http" | "sse"; readonly url: string }
  | { readonly type: "stdio"; readonly command: string; readonly args: ReadonlyArray<string> };

/**
 * How a server signs in: `header`, a key the person types, sent in a header; `oauth`, the
 * person signs in on the provider's page; `oauth-app`, OAuth with an app the person registered.
 */
export type ZeropsMcpAuthKind = "none" | "header" | "oauth" | "oauth-app";

/** What a server is, whoever signs in to it. */
export interface ZeropsMcpServerDefinition {
  /** Its key in every agent's config. */
  readonly name: string;
  /** Its name for the person. */
  readonly title: string;
  readonly transport: ZeropsMcpTransport;
  readonly auth: { readonly kind: ZeropsMcpAuthKind; readonly scopes?: ReadonlyArray<string> };
  readonly docsUrl?: string;
}

/**
 * One value the person types on the card, never the agent: a command's environment variable named
 * `key`, or a remote server's header (`headerName`, else `key`) holding `prefix` and the value.
 */
export interface ZeropsMcpCredentialField {
  readonly key: string;
  readonly label: string;
  readonly placement: "env" | "header";
  readonly headerName?: string;
  readonly prefix?: string;
}

/**
 * The definition apart from its credential fields: they may later live at different scopes (a
 * server the organization defines, each Mate signing in itself).
 */
export interface ZeropsMcpProposalParams {
  readonly scope: ZeropsMcpScope;
  readonly server: ZeropsMcpServerDefinition;
  readonly credentials: ReadonlyArray<ZeropsMcpCredentialField>;
}

/**
 * A hidden value the agent cannot read, shown to the person on the card: its name and whether it is
 * the project's or a service's own. Never the value: a document carrying one is no proposal.
 */
export interface ZeropsRevealProposalParams {
  readonly scope: "project" | "service";
  readonly key: string;
}

export type ZeropsProposal =
  | (ProposalHead & {
      readonly kind: "service.restart" | "service.start" | "service.stop";
      readonly projectId: string;
      readonly serviceId: string;
    })
  | (ProposalHead & {
      readonly kind: "env.set";
      readonly projectId: string;
      readonly params: ZeropsEnvProposalParams;
    })
  | (ProposalHead & {
      readonly kind: "mate.message";
      readonly params: ZeropsMessageProposalParams;
    })
  | (ProposalHead & {
      readonly kind: "chief.message";
      /** The asking Mate's project. */
      readonly projectId: string;
      readonly params: ZeropsChiefMessageParams;
    })
  | (ProposalHead & {
      readonly kind: "domain.add";
      readonly projectId: string;
      readonly serviceId: string;
      readonly params: ZeropsDomainProposalParams;
    })
  | (ProposalHead & {
      readonly kind: "access.set";
      readonly params: ZeropsAccessProposalParams;
    })
  | (ProposalHead & {
      readonly kind: "mcp.add";
      /** The proposing Mate's own project, whose agents get it. */
      readonly projectId: string;
      readonly params: ZeropsMcpProposalParams;
    })
  | (ProposalHead & {
      readonly kind: "env.reveal";
      readonly projectId: string;
      readonly params: ZeropsRevealProposalParams;
    });

const Words = Schema.NonEmptyString;

const Head = {
  id: Words,
  summary: Words,
  reason: Schema.optionalKey(Schema.String),
  projectId: Schema.optionalKey(Words),
  projectName: Schema.optionalKey(Schema.String),
  serviceId: Schema.optionalKey(Words),
  serviceName: Schema.optionalKey(Schema.String),
};

const ServiceProposal = Schema.Struct({
  ...Head,
  kind: Schema.Literals(["service.restart", "service.start", "service.stop"]),
  projectId: Words,
  serviceId: Words,
});

const EnvProposal = Schema.Struct({
  ...Head,
  kind: Schema.Literal("env.set"),
  projectId: Words,
  params: Schema.Struct({
    scope: Schema.Literals(["project", "service"]),
    key: Words,
    value: Schema.String,
    secret: Schema.Boolean,
  }),
});

const MessageProposal = Schema.Struct({
  ...Head,
  kind: Schema.Literal("mate.message"),
  params: Schema.Struct({
    to: Schema.Struct({ projectId: Words, mateName: Words }),
    words: Words,
    attachment: Schema.optionalKey(Schema.Struct({ title: Schema.String, text: Schema.String })),
  }),
});

const ChiefMessageProposal = Schema.Struct({
  ...Head,
  kind: Schema.Literal("chief.message"),
  projectId: Words,
  params: Schema.Struct({
    words: Words,
    attachment: Schema.optionalKey(Schema.Struct({ title: Schema.String, text: Schema.String })),
  }),
});

const DomainProposal = Schema.Struct({
  ...Head,
  kind: Schema.Literal("domain.add"),
  projectId: Words,
  serviceId: Words,
  params: Schema.Struct({
    domains: Schema.NonEmptyArray(Words),
    port: Schema.Int.check(Schema.isGreaterThan(0)),
  }),
});

const AccessProposal = Schema.Struct({
  ...Head,
  kind: Schema.Literal("access.set"),
  params: Schema.Struct({
    projects: Schema.NonEmptyArray(Schema.Struct({ id: Words, name: Schema.String })),
    people: Schema.NonEmptyArray(
      Schema.Struct({
        person: Words,
        level: Schema.Literals(["full", "read", "none", "remove"]),
      }),
    ),
  }),
});

const McpProposal = Schema.Struct({
  ...Head,
  kind: Schema.Literal("mcp.add"),
  projectId: Words,
  params: Schema.Struct({
    scope: Schema.optionalKey(Schema.Literals(["mate", "project", "org"])),
    server: Schema.Struct({
      name: Words,
      title: Schema.optionalKey(Schema.String),
      transport: Schema.Union([
        Schema.Struct({ type: Schema.Literals(["http", "sse"]), url: Words }),
        Schema.Struct({
          type: Schema.Literal("stdio"),
          command: Words,
          args: Schema.optionalKey(Schema.Array(Schema.String)),
        }),
      ]),
      auth: Schema.Struct({
        kind: Schema.Literals(["none", "header", "oauth", "oauth-app"]),
        scopes: Schema.optionalKey(Schema.Array(Schema.String)),
      }),
      docsUrl: Schema.optionalKey(Schema.String),
    }),
    credentials: Schema.optionalKey(
      Schema.Array(
        Schema.Struct({
          key: Words,
          label: Words,
          placement: Schema.Literals(["env", "header"]),
          headerName: Schema.optionalKey(Schema.String),
          prefix: Schema.optionalKey(Schema.String),
        }),
      ),
    ),
  }),
});

const RevealParams = Schema.Struct({
  scope: Schema.Literals(["project", "service"]),
  key: Words,
});

const RevealProposal = Schema.Struct({
  ...Head,
  kind: Schema.Literal("env.reveal"),
  projectId: Words,
  params: RevealParams,
});

/** A reveal's params hold its name and scope and nothing else: never a value. */
const decodeRevealParams = Schema.decodeUnknownOption(RevealParams, { onExcessProperty: "error" });

const ProposalDocument = Schema.Struct({
  proposal: Schema.Union([
    ServiceProposal,
    EnvProposal,
    MessageProposal,
    ChiefMessageProposal,
    DomainProposal,
    AccessProposal,
    McpProposal,
    RevealProposal,
  ]),
});

type DecodedProposal = (typeof ProposalDocument.Type)["proposal"];

const decodeDocument = Schema.decodeUnknownOption(ProposalDocument);

const blank = (text: string | undefined): boolean => text !== undefined && text.trim() === "";

/** A key every agent's config takes (`McpServerName`). */
const MCP_NAME = /^[a-z0-9_-]{1,64}$/i;

type DecodedMcp = Extract<DecodedProposal, { kind: "mcp.add" }>["params"];

/**
 * An MCP server's params, or undefined where they name no server an agent can be given: a name no
 * config takes, a blank field, a field twice, or a field placed where its transport has none (an
 * environment variable is a command's, a header a remote server's).
 */
function mcpParams(params: DecodedMcp): ZeropsMcpProposalParams | undefined {
  const { server } = params;
  const name = server.name.trim();
  if (!MCP_NAME.test(name)) return undefined;
  const remote = server.transport.type !== "stdio";
  const credentials = params.credentials ?? [];
  const keys = new Set<string>();
  for (const field of credentials) {
    if (blank(field.key) || blank(field.label) || keys.has(field.key)) return undefined;
    if ((field.placement === "header") !== remote) return undefined;
    keys.add(field.key);
  }
  const transport: ZeropsMcpTransport =
    server.transport.type === "stdio"
      ? {
          type: "stdio",
          command: server.transport.command,
          args: [...(server.transport.args ?? [])],
        }
      : { type: server.transport.type, url: server.transport.url };
  const scopes = (server.auth.scopes ?? []).map((scope) => scope.trim()).filter(Boolean);
  const title = server.title?.trim();
  return {
    scope: params.scope ?? "mate",
    server: {
      name,
      title: title === undefined || title === "" ? name : title,
      transport,
      auth: { kind: server.auth.kind, ...(scopes.length === 0 ? {} : { scopes }) },
      ...(server.docsUrl === undefined || blank(server.docsUrl) ? {} : { docsUrl: server.docsUrl }),
    },
    credentials: credentials.map((field) => ({
      key: field.key,
      label: field.label,
      placement: field.placement,
      ...(field.headerName === undefined || blank(field.headerName)
        ? {}
        : { headerName: field.headerName.trim() }),
      ...(field.prefix === undefined || field.prefix === "" ? {} : { prefix: field.prefix }),
    })),
  };
}

/**
 * The fields its kind carries, or undefined where what it says is blank or names nowhere. `params`
 * is the document's own, as it was sent.
 */
function shaped(proposal: DecodedProposal, params: unknown): ZeropsProposal | undefined {
  if (blank(proposal.id) || blank(proposal.summary)) return undefined;
  const head: ProposalHead = {
    id: proposal.id,
    summary: proposal.summary,
    ...(proposal.reason === undefined ? {} : { reason: proposal.reason }),
    ...(proposal.projectId === undefined ? {} : { projectId: proposal.projectId }),
    ...(proposal.projectName === undefined ? {} : { projectName: proposal.projectName }),
    ...(proposal.serviceId === undefined ? {} : { serviceId: proposal.serviceId }),
    ...(proposal.serviceName === undefined ? {} : { serviceName: proposal.serviceName }),
  };
  switch (proposal.kind) {
    case "service.restart":
    case "service.start":
    case "service.stop":
      return {
        ...head,
        kind: proposal.kind,
        projectId: proposal.projectId,
        serviceId: proposal.serviceId,
      };
    case "env.set": {
      const { params } = proposal;
      // A service's value names its service: without it, there is nowhere to write it.
      if (blank(params.key) || (params.scope === "service" && proposal.serviceId === undefined))
        return undefined;
      return { ...head, kind: "env.set", projectId: proposal.projectId, params: { ...params } };
    }
    case "mate.message": {
      const { to, words, attachment } = proposal.params;
      if (blank(words) || blank(to.mateName) || blank(to.projectId)) return undefined;
      return {
        ...head,
        kind: "mate.message",
        params: {
          to: { projectId: to.projectId, mateName: to.mateName },
          words,
          ...(attachment === undefined ? {} : { attachment: { ...attachment } }),
        },
      };
    }
    case "chief.message": {
      const { words, attachment } = proposal.params;
      if (blank(words) || blank(proposal.projectId)) return undefined;
      return {
        ...head,
        kind: "chief.message",
        projectId: proposal.projectId,
        params: {
          words,
          ...(attachment === undefined ? {} : { attachment: { ...attachment } }),
        },
      };
    }
    case "domain.add": {
      const { domains, port } = proposal.params;
      if (domains.some(blank)) return undefined;
      return {
        ...head,
        kind: "domain.add",
        projectId: proposal.projectId,
        serviceId: proposal.serviceId,
        params: { domains: [...domains], port },
      };
    }
    case "env.reveal": {
      const { scope, key } = proposal.params;
      // A service's value names its service, by id or by hostname in the Mate's own vault.
      if (
        blank(key) ||
        Option.isNone(decodeRevealParams(params)) ||
        (scope === "service" && proposal.serviceId === undefined && !proposal.serviceName?.trim())
      )
        return undefined;
      return { ...head, kind: "env.reveal", projectId: proposal.projectId, params: { scope, key } };
    }
    case "access.set": {
      const { projects, people } = proposal.params;
      if (people.some(({ person }) => blank(person)) || projects.some(({ id }) => blank(id)))
        return undefined;
      return {
        ...head,
        kind: "access.set",
        params: {
          projects: projects.map(({ id, name }) => ({ id, name })),
          people: people.map(({ person, level }) => ({ person, level })),
        },
      };
    }
    case "mcp.add": {
      const mcp = mcpParams(proposal.params);
      if (mcp === undefined) return undefined;
      return { ...head, kind: "mcp.add", projectId: proposal.projectId, params: mcp };
    }
  }
}

/**
 * The proposal a Zerops tool's result holds, or undefined: another tool's, a result that is not a
 * JSON document, or one whose proposal is not whole.
 */
export function readZeropsProposal(
  toolName: string,
  resultText: string | undefined,
): ZeropsProposal | undefined {
  if (!toolName.startsWith(ZEROPS_TOOL_PREFIX) || resultText === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(resultText);
  } catch {
    return undefined;
  }
  return Option.match(decodeDocument(parsed), {
    onNone: () => undefined,
    onSome: (document) =>
      shaped(
        document.proposal,
        (parsed as { readonly proposal: { readonly params?: unknown } }).proposal.params,
      ),
  });
}
