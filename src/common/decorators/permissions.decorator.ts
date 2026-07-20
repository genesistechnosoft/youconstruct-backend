import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '../../modules/rbac/permissions.constants';

export const PERMISSIONS_KEY = 'permissions';

export const Permissions = (...permissions: PermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
