import { describe, expect, it } from "vite-plus/test";

import { readZeropsProposal, type ZeropsProposal } from "./proposal.ts";

const base = {
  id: "7b0c3f4e-0000-4000-8000-000000000001",
  summary: "Restart medusa in Contoso",
  reason: "Its memory has climbed for an hour and it stopped answering.",
  projectId: "p-contoso",
  projectName: "Contoso",
  serviceId: "s-medusa",
  serviceName: "medusa",
};

const result = (proposal: unknown): string =>
  JSON.stringify({
    proposal,
    note: "Nothing has run. The person approves or declines it on the card.",
  });

describe("readZeropsProposal", () => {
  it.each<[string, string, ZeropsProposal]>([
    [
      "a restart names the service it restarts",
      result({ ...base, kind: "service.restart", params: {} }),
      { ...base, kind: "service.restart", projectId: "p-contoso", serviceId: "s-medusa" },
    ],
    [
      "a start names the service it starts",
      result({ ...base, kind: "service.start", summary: "Start medusa in Contoso" }),
      {
        ...base,
        kind: "service.start",
        summary: "Start medusa in Contoso",
        projectId: "p-contoso",
        serviceId: "s-medusa",
      },
    ],
    [
      "a stop names the service it stops",
      result({ ...base, kind: "service.stop", summary: "Stop medusa in Contoso" }),
      {
        ...base,
        kind: "service.stop",
        summary: "Stop medusa in Contoso",
        projectId: "p-contoso",
        serviceId: "s-medusa",
      },
    ],
    [
      "a project value keeps its key, value and whether it is secret",
      result({
        ...base,
        serviceId: undefined,
        serviceName: undefined,
        kind: "env.set",
        summary: "Set STRIPE_KEY in Contoso",
        params: { scope: "project", key: "STRIPE_KEY", value: "sk_live_x", secret: true },
      }),
      {
        id: base.id,
        reason: base.reason,
        projectName: "Contoso",
        kind: "env.set",
        summary: "Set STRIPE_KEY in Contoso",
        projectId: "p-contoso",
        params: { scope: "project", key: "STRIPE_KEY", value: "sk_live_x", secret: true },
      },
    ],
    [
      "a service's value names its service",
      result({
        ...base,
        kind: "env.set",
        summary: "Set LOG_LEVEL on medusa",
        params: { scope: "service", key: "LOG_LEVEL", value: "debug", secret: false },
      }),
      {
        ...base,
        kind: "env.set",
        summary: "Set LOG_LEVEL on medusa",
        params: { scope: "service", key: "LOG_LEVEL", value: "debug", secret: false },
      },
    ],
    [
      "a message to another Mate carries its words and its attachment",
      result({
        id: base.id,
        kind: "mate.message",
        summary: "Ask Rossy to debug the prod errors",
        reason: "Rossy built the checkout.",
        projectId: "p-shop",
        projectName: "Shop",
        params: {
          to: { projectId: "p-shop", mateName: "Rossy" },
          words: "These prod logs show checkout failing. Please debug it.",
          attachment: { title: "prod · api · last 40 lines", text: "ERR 500 /checkout" },
        },
      }),
      {
        id: base.id,
        kind: "mate.message",
        summary: "Ask Rossy to debug the prod errors",
        reason: "Rossy built the checkout.",
        projectId: "p-shop",
        projectName: "Shop",
        params: {
          to: { projectId: "p-shop", mateName: "Rossy" },
          words: "These prod logs show checkout failing. Please debug it.",
          attachment: { title: "prod · api · last 40 lines", text: "ERR 500 /checkout" },
        },
      },
    ],
    [
      "a message without an attachment is only its words",
      result({
        id: base.id,
        kind: "mate.message",
        summary: "Ask Rossy for the release notes",
        params: { to: { projectId: "p-shop", mateName: "Rossy" }, words: "Write them." },
      }),
      {
        id: base.id,
        kind: "mate.message",
        summary: "Ask Rossy for the release notes",
        params: { to: { projectId: "p-shop", mateName: "Rossy" }, words: "Write them." },
      },
    ],
    [
      "a domain names the project it puts on it, the service and the web port it points at",
      // zcp's own document, as zerops_org_propose_domain answers it.
      `{"proposal":{"id":"11111111-2222-3333-4444-555555555555","kind":"domain.add","summary":"Put Contoso - production on contoso.com and www.contoso.com","reason":"the shop is ready for its own name","projectId":"pProd","projectName":"Contoso - production","serviceId":"sMedusa","serviceName":"medusa","params":{"domains":["contoso.com","www.contoso.com"],"port":9000}},"note":"Nothing has run. The person approves or declines it on the card."}`,
      {
        id: "11111111-2222-3333-4444-555555555555",
        kind: "domain.add",
        summary: "Put Contoso - production on contoso.com and www.contoso.com",
        reason: "the shop is ready for its own name",
        projectId: "pProd",
        projectName: "Contoso - production",
        serviceId: "sMedusa",
        serviceName: "medusa",
        params: { domains: ["contoso.com", "www.contoso.com"], port: 9000 },
      },
    ],
    [
      "access names every project it is written on and each person at their level",
      // zcp's own document, as zerops_org_propose_access answers it.
      `{"proposal":{"id":"11111111-2222-3333-4444-555555555555","kind":"access.set","summary":"Access to Contoso: Dana full access, greta@example.com read only","reason":"asked","projectId":"pProd","projectName":"Contoso","params":{"projects":[{"id":"pProd","name":"Contoso - production"},{"id":"pAlba","name":"Contoso - Alba"}],"people":[{"person":"Dana","level":"full"},{"person":"greta@example.com","level":"read"}]}},"note":"Nothing has run. The person approves or declines it on the card."}`,
      {
        id: "11111111-2222-3333-4444-555555555555",
        kind: "access.set",
        summary: "Access to Contoso: Dana full access, greta@example.com read only",
        reason: "asked",
        projectId: "pProd",
        projectName: "Contoso",
        params: {
          projects: [
            { id: "pProd", name: "Contoso - production" },
            { id: "pAlba", name: "Contoso - Alba" },
          ],
          people: [
            { person: "Dana", level: "full" },
            { person: "greta@example.com", level: "read" },
          ],
        },
      },
    ],
  ])("%s", (_title, text, expected) => {
    expect(readZeropsProposal("zerops_org_propose", text)).toEqual(expected);
  });

  it.each<[string, string, string, ZeropsProposal]>([
    [
      "a project's Mate asks its Chief in words, with what it hands along",
      "zerops_propose_ask_chief",
      result({
        id: base.id,
        kind: "chief.message",
        summary: "Ask your Chief about the shared database",
        reason: "Two projects write the same tables.",
        projectId: "p-shop",
        projectName: "Shop",
        params: {
          words: "Which project owns the orders table?",
          attachment: { title: "schema diff", text: "ALTER TABLE orders" },
        },
      }),
      {
        id: base.id,
        kind: "chief.message",
        summary: "Ask your Chief about the shared database",
        reason: "Two projects write the same tables.",
        projectId: "p-shop",
        projectName: "Shop",
        params: {
          words: "Which project owns the orders table?",
          attachment: { title: "schema diff", text: "ALTER TABLE orders" },
        },
      },
    ],
    [
      "any Zerops tool's result holding a proposal is read, not only the organization's",
      "zerops_manage",
      result({ ...base, kind: "service.restart" }),
      { ...base, kind: "service.restart", projectId: "p-contoso", serviceId: "s-medusa" },
    ],
  ])("%s", (_title, toolName, text, expected) => {
    expect(readZeropsProposal(toolName, text)).toEqual(expected);
  });

  it.each<[string, string, string | undefined]>([
    ["a tool outside Zerops's", "github_restart", result({ ...base, kind: "service.restart" })],
    [
      "an ask of the Chief with no words",
      "zerops_propose_ask_chief",
      result({ ...base, kind: "chief.message", params: { words: " " } }),
    ],
    [
      "an ask of the Chief that names no asking project",
      "zerops_propose_ask_chief",
      result({ ...base, projectId: undefined, kind: "chief.message", params: { words: "Hi" } }),
    ],
    [
      "access at a level Mate does not give",
      "zerops_org_propose_access",
      result({
        ...base,
        kind: "access.set",
        params: {
          projects: [{ id: "p", name: "P" }],
          people: [{ person: "Dana", level: "owner" }],
        },
      }),
    ],
    [
      "access that names nobody",
      "zerops_org_propose_access",
      result({
        ...base,
        kind: "access.set",
        params: { projects: [{ id: "p", name: "P" }], people: [] },
      }),
    ],
    ["a result that is not JSON", "zerops_org_restart", "Restarted medusa."],
    ["a result with no proposal", "zerops_org_projects", JSON.stringify({ projects: [] })],
    ["no result yet", "zerops_org_restart", undefined],
    [
      "a proposal of a kind nobody carries out",
      "zerops_org_delete",
      result({ ...base, kind: "service.delete" }),
    ],
    [
      "a proposal with no id",
      "zerops_org_restart",
      result({ ...base, id: "", kind: "service.restart" }),
    ],
    [
      "a proposal with no summary",
      "zerops_org_restart",
      result({ ...base, summary: "  ", kind: "service.restart" }),
    ],
    [
      "a restart that names no service",
      "zerops_org_restart",
      result({ ...base, serviceId: undefined, kind: "service.restart" }),
    ],
    [
      "a service value that names no service",
      "zerops_org_env",
      result({
        ...base,
        serviceId: undefined,
        kind: "env.set",
        params: { scope: "service", key: "A", value: "1", secret: false },
      }),
    ],
    [
      "a value with no key",
      "zerops_org_env",
      result({
        ...base,
        kind: "env.set",
        params: { scope: "project", key: "", value: "1", secret: false },
      }),
    ],
    [
      "a message with no words",
      "zerops_org_message",
      result({
        id: base.id,
        kind: "mate.message",
        summary: "Ask Rossy",
        params: { to: { projectId: "p-shop", mateName: "Rossy" }, words: "" },
      }),
    ],
    [
      "a message that names no Mate",
      "zerops_org_message",
      result({
        id: base.id,
        kind: "mate.message",
        summary: "Ask Rossy",
        params: { to: { projectId: "p-shop" }, words: "Hi" },
      }),
    ],
    [
      "a domain with no domain name",
      "zerops_org_propose_domain",
      result({ ...base, kind: "domain.add", params: { domains: [], port: 9000 } }),
    ],
    [
      "a domain with a blank domain name",
      "zerops_org_propose_domain",
      result({ ...base, kind: "domain.add", params: { domains: ["shop.com", " "], port: 9000 } }),
    ],
    [
      "a domain that names no service",
      "zerops_org_propose_domain",
      result({
        ...base,
        serviceId: undefined,
        kind: "domain.add",
        params: { domains: ["shop.com"], port: 9000 },
      }),
    ],
    [
      "a domain that names no port",
      "zerops_org_propose_domain",
      result({ ...base, kind: "domain.add", params: { domains: ["shop.com"], port: 0 } }),
    ],
    ["a proposal that is not an object", "zerops_org_restart", JSON.stringify({ proposal: "x" })],
  ])("ignores %s", (_title, toolName, text) => {
    expect(readZeropsProposal(toolName, text)).toBeUndefined();
  });
});
