import { describe, expect, it } from "vite-plus/test";

import type { ZeropsRegistrationResponse, ZeropsUser } from "./api.ts";
import { deriveProvisioningStart } from "./registrationHandoff.ts";

function user(overrides: Partial<ZeropsUser> = {}): ZeropsUser {
  return {
    id: "user-1",
    email: "new@example.com",
    clientUserList: [
      { id: "membership-1", clientId: "org-1", status: "ACTIVE", client: { accountName: "Acme" } },
    ],
    ...overrides,
  };
}

function response(overrides: Partial<ZeropsRegistrationResponse> = {}): ZeropsRegistrationResponse {
  return {
    auth: { accessToken: "access-1" },
    user: user(),
    zcpClaimed: true,
    ...overrides,
  };
}

function responseWithoutZcpClaimed(): ZeropsRegistrationResponse {
  return { auth: { accessToken: "access-1" }, user: user() };
}

describe("deriveProvisioningStart", () => {
  it("follows the freshly registered user's own organization", () => {
    const start = deriveProvisioningStart(response());

    expect(start.clientId).toBe("org-1");
    expect(start.zcpClaimed).toBe(true);
  });

  it("follows the client explicitly selected by a multi-organization hand-over", () => {
    const start = deriveProvisioningStart(
      response({
        clientId: "org-2",
        user: user({
          clientUserList: [
            {
              id: "membership-1",
              clientId: "org-1",
              status: "ACTIVE",
              client: { accountName: "First" },
            },
            {
              id: "membership-2",
              clientId: "org-2",
              status: "ACTIVE",
              client: { accountName: "Selected" },
            },
          ],
        }),
      }),
    );

    expect(start.clientId).toBe("org-2");
  });

  it("carries zcpClaimed through exactly as the platform reported it", () => {
    expect(deriveProvisioningStart(response({ zcpClaimed: false })).zcpClaimed).toBe(false);
    expect(deriveProvisioningStart(responseWithoutZcpClaimed()).zcpClaimed).toBeUndefined();
  });

  it("has no organization to follow when the response carries no user", () => {
    const start = deriveProvisioningStart(response({ user: null }));

    expect(start.clientId).toBeNull();
  });

  it("has no organization to follow when the user has no active membership", () => {
    const start = deriveProvisioningStart(response({ user: user({ clientUserList: [] }) }));

    expect(start.clientId).toBeNull();
  });
});
