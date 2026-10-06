/**
 * Synthetic routing traffic preserving the measured event order: membership removal, replacement
 * routing, then the service switch. Domains and locations use the platform's wire shape.
 */
export const ROUTING_PROJECT = "routing-project";
export const ROUTING_SERVICE = "routing-service";
export const REMOVED_ROUTING = "removed-routing";
export const RECORDED_ROUTING = {
  id: "replacement-routing",
  projectId: ROUTING_PROJECT,
  _version: 1,
  isSynced: true,
  sslEnabled: true,
  domains: [{ domainName: "appstage-demo.prg1.zerops.app" }],
  locations: [{ path: "/", port: 80, serviceStackId: ROUTING_SERVICE }],
};
export const RECORDED_SERVICE = {
  id: ROUTING_SERVICE,
  projectId: ROUTING_PROJECT,
  name: "appstage",
  status: "ACTIVE",
  subdomainAccess: true,
  _version: 45,
  ports: [{ port: 80, scheme: "http" }],
};
