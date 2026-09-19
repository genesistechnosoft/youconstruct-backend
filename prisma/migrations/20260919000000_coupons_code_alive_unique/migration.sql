DROP INDEX "coupons_code_key";

CREATE UNIQUE INDEX "coupons_code_alive_key" ON "coupons"("code")
WHERE "deletedAt" IS NULL;

CREATE INDEX "coupons_code_idx" ON "coupons"("code");
