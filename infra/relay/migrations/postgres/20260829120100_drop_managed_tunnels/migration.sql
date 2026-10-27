-- The relay no longer provisions Cloudflare-managed tunnels: every
-- environment is reached over its own Zerops-provisioned public origin.
ALTER TABLE "relay_environment_links" DROP COLUMN "managed_tunnels_enabled";
--> statement-breakpoint
DROP TABLE IF EXISTS "relay_managed_endpoint_allocations";
--> statement-breakpoint
DROP TABLE IF EXISTS "relay_managed_tunnel_limits";
