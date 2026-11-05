import { expect, it, vi } from "vite-plus/test";

import { visitElements } from "../../test/reactElementTree";

vi.mock("~/zerops/ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({
    activeOrganization: { id: "org", roleCode: "ADMIN", name: "Test", membershipId: "member" },
  }),
}));
import { PersonasSettings } from "./PersonasSettings";
import { PersonaTemplatesSettings } from "./PersonaTemplatesSettings";

it("persona templates start afresh in another organization: no draft or write state carries over", () => {
  const section = visitElements(
    PersonasSettings(),
    (element) => element.type === PersonaTemplatesSettings,
  );
  expect(section?.key).toBe("org");
});
