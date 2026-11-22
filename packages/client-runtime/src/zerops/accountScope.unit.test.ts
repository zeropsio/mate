import { ZeropsUserId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { resolveActiveZeropsOrganization } from "./accountScope.ts";
import { zeropsClientsFromUser } from "./api.ts";

const membership = (id: string, clientId: string, accountName: string) => ({
  id,
  clientId,
  status: "ACTIVE",
  roleCode: "OWNER",
  client: { id: clientId, accountName },
});

const user = (clientUserList: ReadonlyArray<ReturnType<typeof membership>>) => ({
  id: ZeropsUserId.make("user-1"),
  email: "a@b.c",
  clientUserList: [...clientUserList],
});

const first = membership("cu-1", "org-1", "First");
const second = membership("cu-2", "org-2", "Second");
const third = membership("cu-3", "org-3", "Third");

// witness: packages/client-runtime/src/zerops/accountScope.ts | return organizations[0] ?? null; → return organizations.length === 1 ? (organizations[0] ?? null) : null;
it("ZV156: An organisation whose membership reads none is not offered by the switcher, and the selection moves to the next; once the person is a member again it is offered again; breaks: a removed person is offered an organisation every action refuses", () => {
  expect(
    resolveActiveZeropsOrganization(zeropsClientsFromUser(user([first, second, third])), {
      preferredClientId: null,
      storedClientUserId: "cu-2",
    })?.id,
  ).toBe("org-2");

  const removed = zeropsClientsFromUser(user([first, third]));
  expect(removed.map((organization) => organization.id)).toEqual(["org-1", "org-3"]);
  expect(
    resolveActiveZeropsOrganization(removed, {
      preferredClientId: null,
      storedClientUserId: "cu-2",
    })?.id,
  ).toBe("org-1");

  expect(
    resolveActiveZeropsOrganization(zeropsClientsFromUser(user([])), {
      preferredClientId: null,
      storedClientUserId: "cu-2",
    }),
  ).toBeNull();

  const rejoined = zeropsClientsFromUser(
    user([first, membership("cu-9", "org-2", "Second"), third]),
  );
  expect(rejoined.map((organization) => organization.id)).toEqual(["org-1", "org-2", "org-3"]);
  expect(
    resolveActiveZeropsOrganization(rejoined, {
      preferredClientId: null,
      storedClientUserId: "cu-1",
    })?.id,
  ).toBe("org-1");
});
