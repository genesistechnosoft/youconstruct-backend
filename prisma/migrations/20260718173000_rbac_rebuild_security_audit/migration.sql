-- RBAC rebuild support: invitation acceptance metadata and generic security audit log.

ALTER TABLE "invitations"
ADD COLUMN "acceptedById" TEXT,
ADD COLUMN "platformRole" "PlatformRole";

CREATE INDEX "invitations_acceptedById_idx" ON "invitations"("acceptedById");

CREATE TABLE "security_audit_logs" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorRole" "PlatformRole",
    "targetUserId" TEXT,
    "targetType" TEXT,
    "targetId" TEXT,
    "action" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "method" TEXT,
    "path" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "impersonatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "security_audit_logs_actorUserId_createdAt_idx" ON "security_audit_logs"("actorUserId", "createdAt");
CREATE INDEX "security_audit_logs_targetType_targetId_createdAt_idx" ON "security_audit_logs"("targetType", "targetId", "createdAt");
CREATE INDEX "security_audit_logs_action_createdAt_idx" ON "security_audit_logs"("action", "createdAt");

ALTER TABLE "security_audit_logs"
ADD CONSTRAINT "security_audit_logs_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
