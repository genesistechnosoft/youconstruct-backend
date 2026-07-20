import { SetMetadata } from '@nestjs/common';
import { PermissionScope } from '../../../generated/prisma/client.js';

export const ACTIVE_CONTEXT_KEY = 'activeContext';

export const RequireActiveContext = (...scopes: PermissionScope[]) =>
  SetMetadata(ACTIVE_CONTEXT_KEY, scopes);
