import { describe, expect, it } from "vite-plus/test";

import type { MateCredentialAnswer } from "../authorization/giteaBroker.ts";
import {
  GITEA_TOKEN_ENV_KEY,
  GITEA_URL_ENV_KEY,
  MATE_BROKER_URL_ENV_KEY,
  planGiteaCredential,
  planGiteaCredentialRequest,
} from "./giteaCredential.ts";

const GITEA = "https://web-926-3000.prg1.zerops.app";
const OTHER_GITEA = "https://web-41-3000.prg1.zerops.app";
const BROKER = "https://broker-926-8080.prg1.zerops.app";

const MINTED: MateCredentialAnswer = {
  url: GITEA,
  org: "acme",
  bot: "mate-proj-1",
  generation: 2,
  minted: true,
  token: "THE-BOT-TOKEN",
};
const NOT_MINTED: MateCredentialAnswer = {
  url: GITEA,
  org: "acme",
  bot: "mate-proj-1",
  generation: 1,
  minted: false,
};

const SETTLED = {
  [GITEA_URL_ENV_KEY]: GITEA,
  [MATE_BROKER_URL_ENV_KEY]: BROKER,
  [GITEA_TOKEN_ENV_KEY]: "REDACTED",
};

describe("planGiteaCredentialRequest", () => {
  const table: ReadonlyArray<{
    readonly name: string;
    readonly current: Readonly<Record<string, string>>;
    readonly rotate?: boolean;
    readonly expected: string | undefined;
  }> = [
    { name: "nothing yet", current: {}, expected: "ensure" },
    {
      name: "the url only — the write landed, the token never did",
      current: { [GITEA_URL_ENV_KEY]: GITEA },
      expected: "ensure",
    },
    { name: "a token for this Gitea already", current: SETTLED, expected: undefined },
    {
      name: "a token for another Gitea — the old one is dead by definition",
      current: { ...SETTLED, [GITEA_URL_ENV_KEY]: OTHER_GITEA },
      expected: "rotate",
    },
    {
      name: "another Gitea and no token at all",
      current: { [GITEA_URL_ENV_KEY]: OTHER_GITEA },
      expected: "ensure",
    },
    { name: "a person asked for a rotation", current: SETTLED, rotate: true, expected: "rotate" },
  ];

  it.each(table.map((row) => [row.name, row] as const))("%s", (_name, row) => {
    expect(
      planGiteaCredentialRequest({
        giteaOrigin: `${GITEA}/`,
        current: row.current,
        ...(row.rotate === undefined ? {} : { rotate: row.rotate }),
      }),
    ).toBe(row.expected);
  });

  it("never rotates on its own", () => {
    // Ensure is the default everywhere; rotation costs a live token and is a
    // person's decision.
    expect(planGiteaCredentialRequest({ giteaOrigin: GITEA, current: {} })).toBe("ensure");
  });
});

describe("planGiteaCredential", () => {
  it("writes everything for a Mate that has nothing", () => {
    expect(
      planGiteaCredential({ brokerOrigin: `${BROKER}/`, credential: MINTED, current: {} }),
    ).toEqual({
      upToDate: false,
      write: [GITEA_URL_ENV_KEY, MATE_BROKER_URL_ENV_KEY, GITEA_TOKEN_ENV_KEY],
      sensitive: [GITEA_TOKEN_ENV_KEY],
      values: { [GITEA_URL_ENV_KEY]: GITEA, [MATE_BROKER_URL_ENV_KEY]: BROKER },
      restart: true,
    });
  });

  it("writes only the token when the addresses are already right", () => {
    expect(
      planGiteaCredential({
        brokerOrigin: BROKER,
        credential: MINTED,
        current: { [GITEA_URL_ENV_KEY]: GITEA, [MATE_BROKER_URL_ENV_KEY]: BROKER },
      }).write,
    ).toEqual([GITEA_TOKEN_ENV_KEY]);
  });

  it("plans nothing when the broker minted nothing and the addresses match", () => {
    // An ensure that found a live token: there is nothing to write, and
    // writing the key without a value would replace a working credential.
    expect(
      planGiteaCredential({ brokerOrigin: BROKER, credential: NOT_MINTED, current: SETTLED }),
    ).toEqual({ upToDate: true, write: [], sensitive: [], values: {}, restart: false });
  });

  it("repoints a Mate at another Gitea and gives it that instance's token", () => {
    const plan = planGiteaCredential({
      brokerOrigin: BROKER,
      credential: MINTED,
      current: { ...SETTLED, [GITEA_URL_ENV_KEY]: OTHER_GITEA },
    });
    expect(plan.write).toEqual([GITEA_URL_ENV_KEY, GITEA_TOKEN_ENV_KEY]);
    expect(plan.values[GITEA_URL_ENV_KEY]).toBe(GITEA);
  });

  it("writes a moved broker without touching a live token", () => {
    const plan = planGiteaCredential({
      brokerOrigin: "https://broker.example",
      credential: NOT_MINTED,
      current: SETTLED,
    });
    expect(plan.write).toEqual([MATE_BROKER_URL_ENV_KEY]);
    expect(plan.restart).toBe(true);
  });

  it("never carries the bot's token", () => {
    // A plan is progress a UI renders; the value goes straight from the
    // broker's answer into the write.
    const plan = planGiteaCredential({ brokerOrigin: BROKER, credential: MINTED, current: {} });
    expect(plan.values).not.toHaveProperty(GITEA_TOKEN_ENV_KEY);
    expect(JSON.stringify(plan)).not.toContain("THE-BOT-TOKEN");
  });

  it("marks the token sensitive and the two addresses plain", () => {
    const plan = planGiteaCredential({ brokerOrigin: BROKER, credential: MINTED, current: {} });
    expect(plan.sensitive).toEqual([GITEA_TOKEN_ENV_KEY]);
  });

  it("restarts whenever it writes, because a write reaches new processes only", () => {
    for (const current of [{}, SETTLED, { [GITEA_URL_ENV_KEY]: OTHER_GITEA }]) {
      const plan = planGiteaCredential({ brokerOrigin: BROKER, credential: MINTED, current });
      expect(plan.restart).toBe(plan.write.length > 0);
    }
  });
});
