import { describe, expect, it } from "vite-plus/test";
import {
  beginEnvironmentIdentityExchange,
  hasPendingEnvironmentIdentityExchange,
  isCurrentEnvironmentTarget,
} from "./rememberedEnvironments";
describe("restoration target identity", () => {
  const remembered = [{ key: "project:service", environmentId: "history-1" }];
  const environment = { environmentId: "history-1", displayUrl: "https://current.example" };
  it("keeps a stable target after its address changes", () => {
    expect(
      isCurrentEnvironmentTarget(environment, remembered, [
        { key: "project:service", containerOrigin: "https://current.example/" },
      ]),
    ).toBe(true);
  });
  it("does not give a replacement service the old history at the same address", () => {
    expect(
      isCurrentEnvironmentTarget(environment, remembered, [
        { key: "project:new-service", containerOrigin: environment.displayUrl },
      ]),
    ).toBe(false);
  });
  it("does not bind an old route to a replacement server history", () => {
    expect(
      isCurrentEnvironmentTarget({ ...environment, environmentId: "history-2" }, remembered, [
        { key: "project:service", containerOrigin: environment.displayUrl },
      ]),
    ).toBe(false);
  });
  it("removes a target absent from the complete inventory", () => {
    expect(isCurrentEnvironmentTarget(environment, remembered, [])).toBe(false);
  });
  it("keeps other organizations of this account when navigation changes", () => {
    const candidates = [
      { key: "org-a/project:service", containerOrigin: "https://a.example" },
      { key: "org-b/project:service", containerOrigin: "https://b.example" },
    ];
    expect(
      isCurrentEnvironmentTarget(
        { environmentId: "b", displayUrl: "https://b.example" },
        [{ environmentId: "b", key: "org-b/project:service" }],
        candidates,
      ),
    ).toBe(true);
  });
  it("cannot restore another account's remembered environment", () => {
    expect(
      isCurrentEnvironmentTarget(
        environment,
        [],
        [{ key: "project:service", containerOrigin: environment.displayUrl }],
      ),
    ).toBe(false);
  });
});

import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
it("keeps the exchange pending until every overlapping caller finishes", () => {
  openAccountLifetime("exchange-account");
  try {
    const first = beginEnvironmentIdentityExchange("https://container.example/mate");
    const second = beginEnvironmentIdentityExchange("https://container.example");
    first();
    first();
    expect(hasPendingEnvironmentIdentityExchange("https://container.example")).toBe(true);
    second();
    expect(hasPendingEnvironmentIdentityExchange("https://container.example")).toBe(false);
  } finally {
    closeAccountLifetime();
  }
});
it("does not let an old account's completion release a new account's exchange", () => {
  openAccountLifetime("exchange-account-a");
  const oldFinish = beginEnvironmentIdentityExchange("https://container.example");
  closeAccountLifetime();
  openAccountLifetime("exchange-account-b");
  try {
    const newFinish = beginEnvironmentIdentityExchange("https://container.example");
    oldFinish();
    expect(hasPendingEnvironmentIdentityExchange("https://container.example")).toBe(true);
    newFinish();
    expect(hasPendingEnvironmentIdentityExchange("https://container.example")).toBe(false);
  } finally {
    closeAccountLifetime();
  }
});
