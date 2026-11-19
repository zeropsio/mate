import { expect, it } from "@effect/vitest";
import { AtomRegistry } from "effect/reactivity";
import { makeHqApi } from "../../zerops/hq/client.ts";
import { recorded } from "../__fixtures__/recorded.ts";
import { activityLink } from "../families/hqActivity.ts";
import { settingLink } from "../families/hqTaskSources.ts";
import type { LinkKey } from "../model.ts";
import { streamOf } from "../reducer.ts";
import { makeAccountStore, readsOfState, type AccountStore } from "../store.ts";
import { makeActivity } from "./hqActivity.ts";
import { makeTaskSourceSettings } from "./hqTaskSources.ts";

const hqAnswering = (status: number, body: unknown) =>
  makeHqApi({
    address: "https://hq.invalid",
    orgId: "org",
    fetch: () => Promise.resolve(Response.json(body, { status })),
    accessToken: () => Promise.reject(new Error("no door")),
    openSocket: () => {
      throw new Error("no socket");
    },
    now: () => 0,
    kept: {
      read: () => ({ token: "session", expiresAtMs: Number.MAX_SAFE_INTEGER }),
      keep: () => {},
      forget: () => {},
    },
  });

const settled = (store: AccountStore, link: LinkKey) =>
  new Promise<void>((resolve) => {
    const check = () => {
      const { phase } = streamOf(store.state(), link);
      if (phase === "live" || phase === "refused" || phase === "recovering") {
        unsubscribe();
        resolve();
      }
    };
    const unsubscribe = store.subscribe(check);
    check();
  });

// witness: packages/client-runtime/src/zerops/hq/client.ts | readGithub(await authorized("/api/org/github")) → readGithub({ apps: await authorized("/api/org/github") })
it("AD2: The organization's GitHub apps, as HQ sends them, are held whole when a screen asks for them: each app, each installation and each repository with what uses it; HQ's answer is never refused as unreadable", async () => {
  const answer = recorded("GET /api/org/github 200", "mate-hq/org-github.connected");
  const store = makeAccountStore(AtomRegistry.make());
  const settings = makeTaskSourceSettings({
    store,
    api: hqAnswering(200, answer),
    makeId: () => "request",
  });
  const key = { orgId: "org" };
  const release = settings.demandOrg("hqGithub", key);
  try {
    await settled(store, settingLink("hqGithub", key));
    const fact = readsOfState(store.state()).fact("hqGithub", '["org"]');
    expect(fact).toMatchObject({ kind: "known", value: answer });
    const usedBy = { application: null, repo: null, githubAppId: 1 };
    expect(fact).toMatchObject({
      value: {
        apps: [
          {
            appId: 1,
            installations: [{ state: "accepted", repositories: [{ usedBy }, { usedBy }] }],
          },
        ],
      },
    });
  } finally {
    release();
    settings.close();
  }
});

// witness: packages/client-runtime/src/zerops/hq/client.ts | if (response.status >= 500 || → if (response.status >= 400 ||
it("AD3: HQ's refusal of the organization's activity to a person it does not let read it, as HQ sends it, ends the read as denied: it waits for the person and is never asked again as an outage", async () => {
  const refusal = recorded("GET /api/activity 403", "mate-hq/activity.not-structure-writer");
  const store = makeAccountStore(AtomRegistry.make());
  const key = { orgId: "org", before: null };
  const activity = makeActivity({ store, api: hqAnswering(403, refusal) });
  const release = activity.demand(key);
  try {
    await settled(store, activityLink(key));
    expect(streamOf(store.state(), activityLink(key))).toMatchObject({
      phase: "refused",
      fault: { outcome: "authoritative-denial", code: "forbidden" },
    });
  } finally {
    release();
    activity.close();
  }
});
