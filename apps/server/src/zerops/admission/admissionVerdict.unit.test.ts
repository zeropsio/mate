import { SessionSubject, ZEROPS_SUBJECT_PREFIX, ZeropsUserId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { admissionVerdict, asksStanding, type AdmissionFacts } from "./admissionVerdict.ts";

const JAN = ZeropsUserId.make("jan-user-id");
const EVA = ZeropsUserId.make("eva-user-id");
type Principal = AdmissionFacts["principal"];

const session = (userId: ZeropsUserId): Principal => ({
  kind: "session",
  subject: SessionSubject.make(`${ZEROPS_SUBJECT_PREFIX}${userId}`),
});

const signedAgent = {
  kind: "agent",
  agentId: "claude-code",
  token: false,
  refusal: undefined,
} as const;
const tokenAgent = { kind: "agent", agentId: "codex", token: true, refusal: undefined } as const;
const signedLogin = {
  kind: "login",
  login: { id: "claudeAgent-work", agent: "claude-code", kind: "subscription", label: "work" },
  refusal: undefined,
} as const;

const janTurn = {
  principal: session(JAN),
  target: signedAgent,
  organizationKeyOnly: false,
  standing: undefined,
} satisfies AdmissionFacts;
const crew = { kind: "crew", startedBy: JAN } as const;

// witness: apps/server/src/zerops/admission/admissionVerdict.ts | organizationKeyOnly && → (organizationKeyOnly || (target.kind === "agent" && target.token)) &&
it("TA1: A turn on a login its person signed in here, or on an agent a project token authorizes, is admitted", () => {
  const person = { ...janTurn, principal: session(EVA) };
  expect(admissionVerdict({ ...person, target: signedLogin })._tag).toBe("Admit");
  expect(admissionVerdict({ ...person, target: tokenAgent })._tag).toBe("Admit");
});

// witness: apps/server/src/zerops/admission/admissionVerdict.ts | target.kind === "login" ? target.login.id : target.agentId, → target.kind === "login" ? target.login.agent : target.agentId,
it("TA2: A turn on a login that is not signed in, whose sign-in nobody recorded, or that another member signed in is refused and names that login: an agent's own login by its agent id, a login beyond the defaults by its own id", () => {
  for (const [refusal, reason] of [
    [{ kind: "not-signed-in", auth: "not-authorized" }, "missing-sign-in"],
    [{ kind: "unrecorded" }, "unrecorded"],
    [{ kind: "someone-else" }, "not-permitted"],
  ] as const) {
    expect(
      admissionVerdict({
        ...janTurn,
        principal: session(EVA),
        target: { ...signedAgent, refusal },
      }),
    ).toMatchObject({
      _tag: "Refuse",
      kind: refusal.kind,
      agentAdmission: { loginId: "claude-code", reason },
    });
  }
  expect(
    admissionVerdict({
      ...janTurn,
      target: { ...signedLogin, refusal: { kind: "someone-else" } },
    }),
  ).toMatchObject({
    _tag: "Refuse",
    kind: "someone-else",
    agentAdmission: { loginId: "claudeAgent-work", reason: "not-permitted" },
  });
});

// witness: apps/server/src/zerops/admission/admissionVerdict.ts | refusal.auth === "needs-reauth" || refusal.auth === "reconnect" → refusal.auth === "needs-reauth"
it("TA3: A login whose sign-in must be renewed or reconnected is refused as expired; any other login that is not signed in, as missing its sign-in", () => {
  for (const [auth, reason] of [
    ["needs-reauth", "expired-login"],
    ["reconnect", "expired-login"],
    ["not-authorized", "missing-sign-in"],
  ] as const) {
    expect(
      admissionVerdict({
        ...janTurn,
        target: { ...signedLogin, refusal: { kind: "not-signed-in", auth } },
      }),
    ).toMatchObject({
      _tag: "Refuse",
      kind: "not-signed-in",
      agentAdmission: { loginId: "claudeAgent-work", reason },
    });
  }
});

// witness: apps/server/src/zerops/admission/admissionVerdict.ts | return { _tag: "Undetermined", message: SIGNERS_UNHEARD }; → return { _tag: "Refuse", kind: "unrecorded", message: SIGNERS_UNHEARD };
it("TA4: While HQ's map of signers is unheard, a turn on a login with no signer on record is undetermined, never refused, and names no login", () => {
  const verdict = admissionVerdict({
    ...janTurn,
    target: { ...signedAgent, refusal: { kind: "signers-unheard" } },
  });
  expect(verdict._tag).toBe("Undetermined");
  expect(verdict).not.toHaveProperty("agentAdmission");
});

// witness: apps/server/src/zerops/admission/admissionVerdict.ts | kind: "open-mate-once", → kind: "access-lost",
it("TA5: A crew turn on a login its starter signed runs only while HQ says the starter may run turns here: lost access refuses, a needed sign-in refuses, and HQ's silence is undetermined", () => {
  const turn = { ...janTurn, principal: crew };
  expect(admissionVerdict({ ...turn, standing: "may" })._tag).toBe("Admit");
  for (const standing of ["no_access", "left"] as const) {
    expect(admissionVerdict({ ...turn, standing })).toMatchObject({
      _tag: "Refuse",
      kind: "access-lost",
    });
  }
  expect(admissionVerdict({ ...turn, standing: "sign_in_needed" })).toMatchObject({
    _tag: "Refuse",
    kind: "open-mate-once",
  });
  expect(admissionVerdict({ ...turn, standing: undefined })._tag).toBe("Undetermined");
});

// witness: apps/server/src/zerops/admission/admissionVerdict.ts | return principal.kind === "crew" && signedByPrincipal(target); → return (principal.kind === "crew" || principal.kind === "standup") && signedByPrincipal(target);
it("TA6: HQ's standing is asked only for a crew turn on a login its starter signed: a stand-up, a person's own session and a crew turn on a project token run whatever HQ says", () => {
  for (const [principal, target] of [
    [{ kind: "standup", startedBy: JAN }, signedAgent],
    [session(JAN), signedAgent],
    [crew, tokenAgent],
  ] as const) {
    expect(asksStanding(principal, target)).toBe(false);
    expect(admissionVerdict({ ...janTurn, principal, target, standing: "no_access" })._tag).toBe(
      "Admit",
    );
  }
});

// witness: apps/server/src/zerops/admission/admissionVerdict.ts | (target.kind === "login" && target.login.kind === "subscription")) → target.kind === "login")
it("TA7: Where only the organization's key may run, a subscription sign-in or login is refused even for its own signer; an API key login and an instance with no agent run", () => {
  const keyOnly = { ...janTurn, organizationKeyOnly: true };
  const task = { kind: "task", taskId: "task-1" } as const;
  for (const [principal, target] of [
    [session(JAN), signedAgent],
    [session(EVA), signedLogin],
    [task, signedAgent],
  ] as const) {
    expect(admissionVerdict({ ...keyOnly, principal, target })).toMatchObject({
      _tag: "Refuse",
      kind: "organization-key",
    });
  }
  expect(admissionVerdict({ ...keyOnly, principal: task, target: { kind: "none" } })._tag).toBe(
    "Admit",
  );
  expect(
    admissionVerdict({
      ...keyOnly,
      principal: session(EVA),
      target: { ...signedLogin, login: { ...signedLogin.login, kind: "apiKey" } },
    })._tag,
  ).toBe("Admit");
});

// witness: apps/server/src/zerops/admission/admissionVerdict.ts | (target.kind === "login" && target.login.kind === "subscription")) → (target.kind === "login" && target.login.kind === "subscription" && target.refusal === undefined))
it("TA8: A turn refused for more than one reason is refused for the first of: its starter's standing, the organization's key, its login", () => {
  const keyOnly = { ...janTurn, organizationKeyOnly: true };
  expect(admissionVerdict({ ...keyOnly, principal: crew, standing: "no_access" })).toMatchObject({
    _tag: "Refuse",
    kind: "access-lost",
  });
  expect(
    admissionVerdict({
      ...keyOnly,
      principal: session(EVA),
      target: { ...signedLogin, refusal: { kind: "someone-else" } },
    }),
  ).toMatchObject({ _tag: "Refuse", kind: "organization-key" });
});

// witness: apps/server/src/zerops/admission/admissionVerdict.ts | if (principal.kind === "mate" && !signedByPrincipal(target)) { → if (principal.kind === "mate" && target.kind !== "unlisted-agent" && !signedByPrincipal(target)) {
it("TA9: Another Mate's message runs only on a login its owner signed in here: on a project token or an agent nobody lists it is refused for now, and on a login another member signed it is refused for good", () => {
  const turn = {
    ...janTurn,
    principal: { kind: "mate", messageId: "message-1", ownerUserId: JAN },
  } satisfies AdmissionFacts;
  for (const target of [tokenAgent, { kind: "unlisted-agent" }] as const) {
    expect(admissionVerdict({ ...turn, target })).toMatchObject({
      _tag: "Refuse",
      kind: "owner-sign-in",
      forNow: true,
    });
  }
  const refused = admissionVerdict({
    ...turn,
    target: { ...signedAgent, refusal: { kind: "someone-else" } },
  });
  expect(refused).toMatchObject({ _tag: "Refuse", kind: "someone-else" });
  expect(refused).not.toHaveProperty("forNow");
  expect(admissionVerdict({ ...turn, target: signedAgent })._tag).toBe("Admit");
});

// witness: apps/server/src/zerops/admission/admissionVerdict.ts | return { _tag: "Admit" }; → return target.kind === "unlisted-agent" ? { _tag: "Undetermined", message: SIGNERS_UNHEARD } : { _tag: "Admit" };
it("TA10: A turn whose instance resolves to no agent, or to an agent the auth feed does not list, passes unjudged", () => {
  for (const target of [{ kind: "none" }, { kind: "unlisted-agent" }] as const) {
    expect(admissionVerdict({ ...janTurn, target })._tag).toBe("Admit");
  }
});
