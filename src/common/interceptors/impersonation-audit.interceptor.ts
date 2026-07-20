import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { RbacRepository } from '../../modules/rbac/rbac.repository';
import type { AuthenticatedUser } from '../types/auth-user.type';

@Injectable()
export class ImpersonationAuditInterceptor implements NestInterceptor {
  constructor(private readonly rbacRepository: RbacRepository) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user?.isImpersonation || !user.impersonatedBy) {
      return next.handle();
    }

    return next.handle().pipe(
      tap({
        next: () => {
          void this.rbacRepository.createImpersonationLog({
            adminId: user.impersonatedBy!,
            targetUserId: user.userId,
            action: 'API_CALL',
            method: request.method,
            path: request.originalUrl ?? request.url,
            ip: request.ip,
            userAgent: request.headers['user-agent'],
          });
          void this.rbacRepository.createSecurityAuditLog({
            actorUserId: user.userId,
            actorRole: user.platformRole,
            targetUserId: user.userId,
            targetType: 'USER',
            targetId: user.userId,
            action: 'IMPERSONATION_API_CALL',
            result: 'SUCCESS',
            method: request.method,
            path: request.originalUrl ?? request.url,
            ip: request.ip,
            userAgent: request.headers['user-agent'],
            impersonatedBy: user.impersonatedBy,
          });
        },
        error: () => {
          void this.rbacRepository.createImpersonationLog({
            adminId: user.impersonatedBy!,
            targetUserId: user.userId,
            action: 'API_CALL_FAILED',
            method: request.method,
            path: request.originalUrl ?? request.url,
            ip: request.ip,
            userAgent: request.headers['user-agent'],
          });
          void this.rbacRepository.createSecurityAuditLog({
            actorUserId: user.userId,
            actorRole: user.platformRole,
            targetUserId: user.userId,
            targetType: 'USER',
            targetId: user.userId,
            action: 'IMPERSONATION_API_CALL',
            result: 'FAILURE',
            method: request.method,
            path: request.originalUrl ?? request.url,
            ip: request.ip,
            userAgent: request.headers['user-agent'],
            impersonatedBy: user.impersonatedBy,
          });
        },
      }),
    );
  }
}
