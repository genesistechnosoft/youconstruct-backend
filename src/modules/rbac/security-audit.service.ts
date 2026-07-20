import { Injectable } from '@nestjs/common';
import { PlatformRole, Prisma } from '../../../generated/prisma/client.js';
import { RbacRepository } from './rbac.repository';

export type SecurityAuditInput = {
  actorUserId?: string;
  actorRole?: PlatformRole;
  targetUserId?: string;
  targetType?: string;
  targetId?: string;
  action: string;
  result: 'SUCCESS' | 'FAILURE';
  method?: string;
  path?: string;
  ip?: string;
  userAgent?: string;
  metadata?: Prisma.InputJsonValue;
  impersonatedBy?: string;
};

@Injectable()
export class SecurityAuditService {
  constructor(private readonly rbacRepository: RbacRepository) {}

  /**
   * Fire-and-forget audit write — never throws to callers.
   */
  log(input: SecurityAuditInput): void {
    void this.rbacRepository.createSecurityAuditLog(input).catch(() => undefined);
  }

  async logAwaited(input: SecurityAuditInput) {
    return this.rbacRepository.createSecurityAuditLog(input);
  }
}
