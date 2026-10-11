import { expect, it } from "vite-plus/test";
import { MateFake } from "../mate.ts";
import { ChatDriver } from "../../areas/c-mate/fake.ts";

// Catches a fake treating personal credentials as a shared project token and making read-only scenarios meaningless.
it("distinguishes project token, colleague OAuth and unrecorded OAuth facts", () => {
  const chat = new ChatDriver(new MateFake("Ada", "Ada"));
  expect(chat.auth().agents[0]).toMatchObject({ flagToken: true, flagOAuth: false });
  chat.ownership = "colleague";
  expect(chat.auth().agents[0]).toMatchObject({
    flagToken: false,
    flagOAuth: true,
    authorizedBy: { subject: "colleague" },
  });
  chat.ownership = "unrecorded";
  expect(chat.auth().agents[0]?.authorizedBy).toBeUndefined();
});
