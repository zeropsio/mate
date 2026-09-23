import { expect, it } from "vite-plus/test";
import {
  beginEnvironmentIdentityExchange,
  hasPendingEnvironmentIdentityExchange,
} from "./rememberedEnvironments";
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
