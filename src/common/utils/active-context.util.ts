import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../types/auth-user.type';

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
