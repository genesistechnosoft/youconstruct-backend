import {
  PermissionScope,
  PlatformRole,
} from '../../../generated/prisma/client.js';

export type ActiveContext = {
  type: PermissionScope;
  entityId: string | null;
  customRoleId: string;
  roleName?: string;
  isOwner?: boolean;
};

export type AuthSessionContext = {
  type: PermissionScope;
  entityId: string | null;
  customRoleId: string;
  roleName: string;
  isOwner: boolean;
};

export type AuthSession = {
  user: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    platformRole: PlatformRole;
  };
  activeContext: AuthSessionContext | null;
  permissions: string[];
  flags: {
    needsOnboarding: boolean;
    isImpersonating: boolean;
  };
};

export type AuthenticatedUser = {
  userId: string;
  platformRole: PlatformRole;
  activeContext?: ActiveContext;
  impersonatedBy?: string;
  isImpersonation?: boolean;
};

/** Identity-only JWT payload — never trust permissions or business context from the token */
export type JwtPayload = {
  userId: string;
  platformRole?: PlatformRole;
  impersonatedBy?: string;
  isImpersonation?: boolean;
};
