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
  isSuspended?: boolean;
};

export type AuthSessionContext = {
  type: PermissionScope;
  entityId: string | null;
  customRoleId: string;
  roleName: string;
  isOwner: boolean;
  isSuspended: boolean;
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
    accessRevoked: boolean;
  };
};

export type AuthenticatedUser = {
  userId: string;
  platformRole: PlatformRole;
  activeContext?: ActiveContext;
  /** Held a team membership that has since been removed. */
  accessRevoked?: boolean;
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
