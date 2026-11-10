import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../types/auth-user.type';
import { PermissionScope } from '../../../generated/prisma/client.js';

export function requireVendorEntityId(user: AuthenticatedUser): string {
  if (
    !user.activeContext ||
    user.activeContext.type !== 'VENDOR' ||
    !user.activeContext.entityId
  ) {
    throw new ForbiddenException('Active vendor context required');
  }

  return user.activeContext.entityId;
}

export function requireProfessionalEntityId(user: AuthenticatedUser): string {
  if (
    !user.activeContext ||
    user.activeContext.type !== PermissionScope.PROFESSIONAL ||
    !user.activeContext.entityId
  ) {
    throw new ForbiddenException('Active professional context required');
  }

  return user.activeContext.entityId;
}
