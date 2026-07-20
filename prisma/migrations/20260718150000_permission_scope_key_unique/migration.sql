-- Allow the same permission key in different scopes (e.g. media:upload for VENDOR and PROFESSIONAL)
DROP INDEX IF EXISTS "permissions_key_key";

CREATE UNIQUE INDEX "permissions_scope_key_key" ON "permissions"("scope", "key");
