import type { AccountEnvironments } from "@t3tools/client-runtime/zerops/account/runtime";
import type { RegistrationRecord } from "@t3tools/client-runtime/zerops/environments";
import { EnvironmentId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { bindAccountEnvironments } from "./accountEnvironments";
import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import { useRegistrationRecords } from "./registrationRecords";

const record: RegistrationRecord = {
  targetKey: "project-a:service-a",
  environmentId: EnvironmentId.make("environment-a"),
  origin: "https://zcp-1-8080.prg1.zerops.app",
  projectRef: { projectId: "project-a", orgId: "org-1" },
  name: "shop",
};

/** A post-grant stage whose records are `records` and never change; nothing else of it is read. */
const stageWith = (records: ReadonlyArray<RegistrationRecord>) =>
  ({ records: () => records, subscribe: () => () => undefined }) as unknown as AccountEnvironments;

function Records() {
  return <>{JSON.stringify(useRegistrationRecords())}</>;
}

const rendered = (): unknown =>
  JSON.parse(renderToStaticMarkup(<Records />).replaceAll("&quot;", '"'));

afterEach(() => {
  closeAccountLifetime();
});

describe("the web's registration records", () => {
  it("are the account runtime's, and none are read before its first grant or after sign-out", () => {
    openAccountLifetime("user-a");
    expect(rendered()).toEqual([]);

    bindAccountEnvironments(stageWith([record]));
    expect(rendered()).toEqual([record]);

    closeAccountLifetime();
    expect(rendered()).toEqual([]);
  });
});
