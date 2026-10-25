/**
 * A proposal: what a Zerops tool asks the person to approve. The Chief's organization tools
 * (`zerops_org_*`) propose changes to the organization; a project's Mate proposes asking the
 * organization's Chief (`zerops_propose_ask_chief`). Those tools never act. Each returns one document
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
  | "access.set";

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

const ProposalDocument = Schema.Struct({
  proposal: Schema.Union([
    ServiceProposal,
    EnvProposal,
    MessageProposal,
    ChiefMessageProposal,
    DomainProposal,
    AccessProposal,
  ]),
});

type DecodedProposal = (typeof ProposalDocument.Type)["proposal"];

const decodeDocument = Schema.decodeUnknownOption(ProposalDocument);

const blank = (text: string | undefined): boolean => text !== undefined && text.trim() === "";

/** The fields its kind carries, or undefined where what it says is blank or names nowhere. */
function shaped(proposal: DecodedProposal): ZeropsProposal | undefined {
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
    onSome: (document) => shaped(document.proposal),
  });
}
