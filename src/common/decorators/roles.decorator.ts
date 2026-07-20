import { SetMetadata } from '@nestjs/common';
import { PlatformRole } from '../../../generated/prisma/client.js';

export const ROLES_KEY = 'roles';

export { PlatformRole };

export const Roles = (...roles: PlatformRole[]) =>
  SetMetadata(ROLES_KEY, roles);
