-- AlterTable
ALTER TABLE "permissions" ADD COLUMN "name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "permissions" ADD COLUMN "group" TEXT NOT NULL DEFAULT '';
ALTER TABLE "permissions" ADD COLUMN "isElevated" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "permissions" ALTER COLUMN "name" DROP DEFAULT;
ALTER TABLE "permissions" ALTER COLUMN "group" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "permissions_scope_group_idx" ON "permissions"("scope", "group");
