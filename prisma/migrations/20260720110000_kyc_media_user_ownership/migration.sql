-- Add USER owner type for compliance/KYC media isolation
ALTER TYPE "MediaOwnerType" ADD VALUE IF NOT EXISTS 'USER';
