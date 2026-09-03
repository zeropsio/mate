import { describe, expect, it } from "vite-plus/test";

import {
  humanizeCheckName,
  humanizeToolName,
  operationStatusWord,
  sentenceCase,
  statusWord,
} from "./phrases.ts";

describe("statusWord", () => {
  const doneRaws = ["ACTIVE", "DEPLOYED", "FINISHED", "complete", "pass", "healthy", "mounted"];
  for (const raw of doneRaws) {
    it(`maps ${raw} to Done`, () => {
      expect(statusWord(raw)).toBe("Done");
    });
  }

  const runningRaws = ["BUILDING", "DEPLOYING", "RUNNING", "in_progress", "running"];
  for (const raw of runningRaws) {
    it(`maps ${raw} to Running`, () => {
      expect(statusWord(raw)).toBe("Running");
    });
  }

  const failedRaws = ["FAILED", "BUILD_FAILED", "fail", "error"];
  for (const raw of failedRaws) {
    it(`maps ${raw} to Failed`, () => {
      expect(statusWord(raw)).toBe("Failed");
    });
  }

  it("maps pending to Waiting", () => {
    expect(statusWord("pending")).toBe("Waiting");
  });

  it("maps a WAITING_* raw to Waiting", () => {
    expect(statusWord("WAITING_FOR_BUILD")).toBe("Waiting");
  });

  it("maps skipped to Skipped", () => {
    expect(statusWord("skipped")).toBe("Skipped");
  });

  it("sentence-cases an unrecognized raw instead of rendering it verbatim", () => {
    expect(statusWord("SOME_NEW_ENUM")).toBe("Some new enum");
  });
});

describe("sentenceCase", () => {
  it("capitalizes only the first letter of an underscored value", () => {
    expect(sentenceCase("some_new_enum")).toBe("Some new enum");
  });
});

describe("humanizeCheckName", () => {
  it("humanizes service_running", () => {
    expect(humanizeCheckName("service_running")).toBe("Service running");
  });

  it("uppercases http in http_root", () => {
    expect(humanizeCheckName("http_root")).toBe("HTTP root");
  });

  it("humanizes error_logs", () => {
    expect(humanizeCheckName("error_logs")).toBe("Error logs");
  });

  it("uppercases known tokens: https, url, ssh, db", () => {
    expect(humanizeCheckName("https_url")).toBe("HTTPS URL");
    expect(humanizeCheckName("ssh_ready")).toBe("SSH ready");
    expect(humanizeCheckName("db_connection")).toBe("DB connection");
  });
});

describe("humanizeToolName", () => {
  it("turns zerops_discover into Discover", () => {
    expect(humanizeToolName("zerops_discover")).toBe("Discover");
  });

  it("turns zerops_yml_exists into Yml exists", () => {
    expect(humanizeToolName("zerops_yml_exists")).toBe("Yml exists");
  });
});

describe("operationStatusWord — running phase", () => {
  it("deploy running is Deploying", () => {
    expect(operationStatusWord("deploy", "running")).toBe("Deploying");
  });

  it("verify running is Checking", () => {
    expect(operationStatusWord("verify", "running")).toBe("Checking");
  });

  it("import running is Importing", () => {
    expect(operationStatusWord("import", "running")).toBe("Importing");
  });

  it("mount running is Mounting", () => {
    expect(operationStatusWord("mount", "running")).toBe("Mounting");
  });

  it("delete/scale/manage/env running is Working", () => {
    expect(operationStatusWord("delete", "running")).toBe("Working");
    expect(operationStatusWord("scale", "running")).toBe("Working");
    expect(operationStatusWord("manage", "running")).toBe("Working");
    expect(operationStatusWord("env", "running")).toBe("Working");
  });

  it("bootstrap running is In progress", () => {
    expect(operationStatusWord("bootstrap", "running")).toBe("In progress");
  });

  it("a deploy running with a BUILD_TRIGGERED result says Build triggered", () => {
    expect(operationStatusWord("deploy", "running", { resultStatus: "BUILD_TRIGGERED" })).toBe(
      "Build triggered",
    );
  });

  it("subdomain running is Enabling or Disabling by action", () => {
    expect(operationStatusWord("subdomain", "running", { action: "enable" })).toBe("Enabling");
    expect(operationStatusWord("subdomain", "running", { action: "disable" })).toBe("Disabling");
  });
});

describe("operationStatusWord — done phase", () => {
  it("deploy done is Deployed", () => {
    expect(operationStatusWord("deploy", "done")).toBe("Deployed");
  });

  it("verify done is Healthy", () => {
    expect(operationStatusWord("verify", "done")).toBe("Healthy");
  });

  it("import done is Imported", () => {
    expect(operationStatusWord("import", "done")).toBe("Imported");
  });

  it("mount done is Mounted", () => {
    expect(operationStatusWord("mount", "done")).toBe("Mounted");
  });

  it("bootstrap done is Complete", () => {
    expect(operationStatusWord("bootstrap", "done")).toBe("Complete");
  });
});

describe("operationStatusWord — failed phase", () => {
  it("deploy failed is Failed", () => {
    expect(operationStatusWord("deploy", "failed")).toBe("Failed");
  });

  it("verify failed is Checks failed", () => {
    expect(operationStatusWord("verify", "failed")).toBe("Checks failed");
  });

  it("import failed is Import failed", () => {
    expect(operationStatusWord("import", "failed")).toBe("Import failed");
  });

  it("mount failed is Mount failed", () => {
    expect(operationStatusWord("mount", "failed")).toBe("Mount failed");
  });

  it("error kind is always Failed", () => {
    expect(operationStatusWord("error", "failed")).toBe("Failed");
  });

  it("subdomain done is Enabled or Disabled by action", () => {
    expect(operationStatusWord("subdomain", "done", { action: "enable" })).toBe("Enabled");
    expect(operationStatusWord("subdomain", "done", { action: "disable" })).toBe("Disabled");
  });
});
