/**
 * Zerops device login as the platform answers it (`client-runtime/zerops/deviceLogin`), and its
 * consent page: a request the client starts, the person approves or denies in the Zerops window,
 * the client collects by polling. An approved login is a session that renews itself and ends at
 * the platform; an approved sudo request puts the session that asked in sudo mode. Like HQ's, the
 * page sends a tab that asked to come back (`back`) home after either answer.
 *
 * Sessions are the person's: every other route sees the person's own credential (`credential`).
 */
import type { WireRequest, WireResponse } from "../harness/http.ts";
import { definePerson, type ScenarioWorld } from "./zeropsWorld.ts";

/** Where the consent page lives; the API names it in each request's `verificationUrl`. */
export const CONSENT_ORIGIN = "https://app.zerops.io";
const CONSENT_PATH = "/authorize-login";
const REQUEST_LIFETIME_S = 300;
// The platform's access token lives six hours (measured 2026-10-24; five days on 2026-10-13).
const SESSION_LIFETIME_S = 21_600;
const SUDO_MS = 2 * 3_600_000;

interface DeviceRequest {
  readonly kind: "login" | "sudo";
  readonly pollSecret: string;
  readonly userCode: string;
  readonly appCode: string;
  /** A sudo request's: the session that asked. */
  readonly session: Session | undefined;
  status: "PENDING" | "APPROVED" | "DENIED";
  /** An approved login's. */
  approved: Session | undefined;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** The person's own credential, which every other route answers. */
  readonly person: string;
  sudoUntil: number | null;
  /** The access token is refused; its refresh token still renews it. */
  accessExpired: boolean;
}

export interface Newcomer {
  readonly name: string;
  readonly orgId: string;
  readonly orgName: string;
}

export class ZeropsDeviceLogin {
  readonly requests = new Map<string, DeviceRequest>();
  readonly sessions: Session[] = [];
  /** Access tokens that ended at the platform by sign-out, in order. */
  readonly revoked: string[] = [];
  /** Who a sign-up through the consent page creates. */
  newcomer: Newcomer = { name: "newcomer", orgId: "NEWORG", orgName: "Newcomer" };
  /** Each consent page shown, by the address it was opened at. */
  readonly consentPages: URL[] = [];
  /**
   * HQ's Mate card left its note in the tab: a pending login that asks to come back is approved at
   * once, without the card, and the tab is sent home.
   */
  approvesFromHq = false;
  private readonly ended = new Set<string>();
  private serial = 0;
  private held: { promise: Promise<void>; release: () => void } | undefined;

  private readonly world: ScenarioWorld;
  private readonly now: () => number;

  constructor(world: ScenarioWorld, now: () => number) {
    this.world = world;
    this.now = now;
  }

  /**
   * New requests are answered only once released: a test gets the Zerops window ready (its
   * routing) before the client points it at the consent page.
   */
  holdStarts(): () => void {
    let release = () => {};
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = { promise, release };
    this.held = held;
    return () => {
      if (this.held === held) this.held = undefined;
      release();
    };
  }

  /** The platform forgets every open request: the next check answers 404. */
  expireRequests() {
    this.requests.clear();
  }

  /** The session's access token is refused from now on; its refresh token still works. */
  expireAccess(accessToken: string) {
    const session = this.sessions.find((candidate) => candidate.accessToken === accessToken);
    if (!session) throw new Error(`No session holds ${accessToken}`);
    session.accessExpired = true;
  }

  /**
   * The credential the rest of the platform answers for `bearer`: the person's own for a live
   * session, `null` for one refused (expired, rotated or ended), `undefined` for no session.
   */
  credential(bearer: string | undefined): string | null | undefined {
    if (bearer === undefined) return undefined;
    if (this.ended.has(bearer)) return null;
    const session = this.sessions.find((candidate) => candidate.accessToken === bearer);
    if (!session) return undefined;
    return session.accessExpired ? null : session.person;
  }

  /** Sudo mode: a personal token is always in it, a session only once it confirmed. */
  inSudo(bearer: string): boolean {
    const session = this.sessions.find((candidate) => candidate.accessToken === bearer);
    return session === undefined || (session.sudoUntil ?? 0) > this.now();
  }

  /** The routes it owns; `undefined` for the rest. */
  async handle(request: WireRequest, path: string): Promise<WireResponse | undefined> {
    const bearer = request.headers.authorization?.replace(/^Bearer /u, "");
    const key = `${request.method} ${path}`;
    switch (key) {
      case "POST /auth/device-login":
        return this.start("login", request, undefined);
      case "POST /auth/device-login/sudo": {
        const session = this.sessions.find((candidate) => candidate.accessToken === bearer);
        if (!session || this.credential(bearer) === null) return refused(401, "notAuthorized");
        return this.start("sudo", request, session);
      }
      case "POST /auth/device-login/check":
        return this.check(request);
      case "POST /auth/refresh":
        return this.refresh(request);
      case "POST /auth/logout": {
        const credential = this.credential(bearer);
        if (credential === null || bearer === undefined) return refused(401, "notAuthorized");
        // A personal token answers 200 and stays: it cannot end itself.
        if (credential === undefined)
          return this.world.tokens.has(bearer) ? { body: {} } : refused(401, "notAuthorized");
        const index = this.sessions.findIndex((session) => session.accessToken === bearer);
        const [session] = this.sessions.splice(index, 1);
        this.ended.add(session!.accessToken);
        this.ended.add(session!.refreshToken);
        this.revoked.push(session!.accessToken);
        return { body: {} };
      }
      case `GET ${CONSENT_PATH}`:
        return this.consentPage(request);
      case `POST ${CONSENT_PATH}`:
        return this.decide(request);
    }
    return undefined;
  }

  private async start(
    kind: "login" | "sudo",
    request: WireRequest,
    session: Session | undefined,
  ): Promise<WireResponse> {
    const appCode = request.body.appCode;
    if (typeof appCode !== "string" || appCode === "") return refused(400, "invalidAppCode");
    await this.held?.promise;
    const requestId = `device-${++this.serial}`;
    const userCode = `MATE-${String(this.serial).padStart(4, "0")}`;
    this.requests.set(requestId, {
      kind,
      pollSecret: `poll-${this.serial}`,
      userCode,
      appCode,
      session,
      status: "PENDING",
      approved: undefined,
    });
    return {
      body: {
        requestId,
        pollSecret: `poll-${this.serial}`,
        userCode,
        verificationUrl: `${CONSENT_ORIGIN}${CONSENT_PATH}?request=${requestId}`,
        expiresIn: REQUEST_LIFETIME_S,
        interval: 1,
      },
    };
  }

  private check(request: WireRequest): WireResponse {
    const requestId = String(request.body.requestId);
    const pending = this.requests.get(requestId);
    if (!pending || pending.pollSecret !== request.body.pollSecret)
      return refused(404, "deviceLoginNotFound");
    if (pending.status === "PENDING") return { body: { status: "PENDING", auth: null } };
    // Settled works once.
    this.requests.delete(requestId);
    if (pending.status === "DENIED") return { body: { status: "DENIED", auth: null } };
    if (pending.kind === "sudo") return { body: { status: "APPROVED", auth: null } };
    const session = pending.approved!;
    return {
      body: {
        status: "APPROVED",
        auth: {
          auth: this.wire(session),
          user: { id: this.world.people.get(session.person) ?? session.person },
        },
      },
    };
  }

  private refresh(request: WireRequest): WireResponse {
    const session = this.sessions.find(
      (candidate) => candidate.refreshToken === request.body.refreshTokenId,
    );
    if (!session) return refused(400, "refreshTokenInvalid");
    // Both tokens rotate: the old pair is refused from now on.
    this.ended.add(session.accessToken);
    this.ended.add(session.refreshToken);
    const serial = ++this.serial;
    session.accessToken = `session-${serial}`;
    session.refreshToken = `refresh-${serial}`;
    session.accessExpired = false;
    return { body: this.wire(session) };
  }

  private issue(person: string): Session {
    const serial = ++this.serial;
    const session: Session = {
      accessToken: `session-${serial}`,
      refreshToken: `refresh-${serial}`,
      person,
      sudoUntil: null,
      accessExpired: false,
    };
    this.sessions.push(session);
    return session;
  }

  private wire(session: Session) {
    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      tokenType: "Bearer",
      expiresIn: SESSION_LIFETIME_S,
      expiresAt: new Date(this.now() + SESSION_LIFETIME_S * 1000).toISOString(),
      twoFAMethods: [],
      twoFAVerified: false,
      sudoUntil: session.sudoUntil === null ? null : new Date(session.sudoUntil).toISOString(),
      userId: this.world.people.get(session.person) ?? session.person,
    };
  }

  /** The page the Zerops window shows: who asks, the code to compare, Approve and Deny. */
  private consentPage(request: WireRequest): WireResponse {
    this.consentPages.push(request.url);
    const requestId = request.url.searchParams.get("request") ?? "";
    const pending = this.requests.get(requestId);
    if (!pending) return { status: 404, html: page("This request has expired.") };
    const back = request.url.searchParams.get("back");
    if (this.approvesFromHq && back !== null && pending.kind === "login") {
      pending.status = "APPROVED";
      pending.approved = this.issue(String(request.headers["x-scenario-person"] ?? "personal"));
      return { status: 302, headers: { location: back }, body: {} };
    }
    const register = request.url.searchParams.get("intent") === "register";
    const title =
      pending.kind === "sudo"
        ? "Confirm it's you"
        : register
          ? `Create your Zerops account for ${pending.appCode}`
          : `Sign in to ${pending.appCode}`;
    const field = (name: string) => {
      const value = request.url.searchParams.get(name);
      return value === null ? "" : `<input type="hidden" name="${name}" value="${escape(value)}">`;
    };
    return {
      html: page(
        `<h1>${escape(title)}</h1><p data-user-code>${escape(pending.userCode)}</p>
<form method="post" action="${CONSENT_PATH}">
<input type="hidden" name="request" value="${escape(requestId)}">${field("display")}${field("intent")}${field("back")}
<button name="decision" value="approve">Approve</button>
<button name="decision" value="deny">Deny</button>
</form>`,
      ),
    };
  }

  /**
   * The person's decision, as the person signed in to Zerops in that browser (the harness's
   * `x-scenario-person`), or a new account for a sign-up. A popup closes itself after; a tab that
   * asked to come back goes home.
   */
  private decide(request: WireRequest): WireResponse {
    const pending = this.requests.get(String(request.body.request));
    if (!pending) return { status: 404, html: page("This request has expired.") };
    const approve = request.body.decision === "approve";
    pending.status = approve ? "APPROVED" : "DENIED";
    if (approve && pending.kind === "sudo") pending.session!.sudoUntil = this.now() + SUDO_MS;
    if (approve && pending.kind === "login") {
      const person =
        request.body.intent === "register"
          ? this.register()
          : String(request.headers["x-scenario-person"] ?? "personal");
      pending.approved = this.issue(person);
    }
    const back = request.body.back;
    if (typeof back === "string" && back !== "")
      return { status: 302, headers: { location: back }, body: {} };
    const done = approve ? "Done. Return to Mate." : "Cancelled.";
    return {
      html: page(
        request.body.display === "popup" ? `${done}<script>window.close()</script>` : done,
      ),
    };
  }

  /** Sign-up: a new person, owner of a new organization with nothing in it. */
  private register(): string {
    const { name, orgId, orgName } = this.newcomer;
    this.world.organizations.set(orgId, { name: orgName });
    return definePerson(this.world, name, { orgId, role: "OWNER" }).token;
  }
}

function refused(status: number, code: string): WireResponse {
  return { status, body: { error: { code, message: code, meta: [] } } };
}

function escape(text: string) {
  return text.replace(/[&<>"']/gu, (character) => `&#${character.codePointAt(0)!.toString(10)};`);
}

function page(body: string) {
  return `<!doctype html><meta charset="utf-8"><title>Zerops</title><body>${body}</body>`;
}
