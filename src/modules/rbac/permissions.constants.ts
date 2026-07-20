import { PermissionScope } from '../../../generated/prisma/client.js';

export const PERMISSIONS = {
  ADMIN: {
    VENDORS_VIEW: 'vendors:view',
    VENDORS_APPROVE: 'vendors:approve',
    VENDORS_REJECT: 'vendors:reject',
    CATALOG_MANAGE: 'catalog:manage',
    USERS_IMPERSONATE: 'users:impersonate',
    ROLES_MANAGE: 'roles:manage',
  },
  VENDOR: {
    PRODUCTS_VIEW: 'products:view',
    PRODUCTS_CREATE: 'products:create',
    PRODUCTS_EDIT: 'products:edit',
    PRODUCTS_DELETE: 'products:delete',
    INVENTORY_MANAGE: 'inventory:manage',
    MEDIA_UPLOAD: 'media:upload',
    MEDIA_DELETE: 'media:delete',
    TEAM_MANAGE: 'team:manage',
    ROLES_MANAGE: 'roles:manage',
  },
  PROFESSIONAL: {
    TEAM_MANAGE: 'team:manage',
    ROLES_MANAGE: 'roles:manage',
  },
} as const;

export type PermissionKey =
  | (typeof PERMISSIONS.ADMIN)[keyof typeof PERMISSIONS.ADMIN]
  | (typeof PERMISSIONS.VENDOR)[keyof typeof PERMISSIONS.VENDOR]
  | (typeof PERMISSIONS.PROFESSIONAL)[keyof typeof PERMISSIONS.PROFESSIONAL];

export type PermissionCatalogEntry = {
  key: PermissionKey;
  name: string;
  group: string;
  scope: PermissionScope;
  description: string;
  isElevated: boolean;
};

export const PERMISSION_CATALOG: PermissionCatalogEntry[] = [
  // ── ADMIN ──────────────────────────────────────────────
  {
    key: PERMISSIONS.ADMIN.VENDORS_VIEW,
    name: 'View Vendors',
    group: 'Vendors',
    scope: PermissionScope.ADMIN,
    description: 'View vendor profiles and onboarding status',
    isElevated: false,
  },
  {
    key: PERMISSIONS.ADMIN.VENDORS_APPROVE,
    name: 'Approve Vendor',
    group: 'Vendors',
    scope: PermissionScope.ADMIN,
    description: 'Approve a submitted vendor onboarding application',
    isElevated: false,
  },
  {
    key: PERMISSIONS.ADMIN.VENDORS_REJECT,
    name: 'Reject Vendor',
    group: 'Vendors',
    scope: PermissionScope.ADMIN,
    description: 'Reject a submitted vendor onboarding application',
    isElevated: false,
  },
  {
    key: PERMISSIONS.ADMIN.CATALOG_MANAGE,
    name: 'Manage Catalog',
    group: 'Catalog',
    scope: PermissionScope.ADMIN,
    description: 'Manage categories, brands, and product approvals',
    isElevated: false,
  },
  {
    key: PERMISSIONS.ADMIN.USERS_IMPERSONATE,
    name: 'Impersonate User',
    group: 'Users',
    scope: PermissionScope.ADMIN,
    description: 'Act as another user for support (short-lived session)',
    isElevated: true,
  },
  {
    key: PERMISSIONS.ADMIN.ROLES_MANAGE,
    name: 'Manage Roles',
    group: 'Team',
    scope: PermissionScope.ADMIN,
    description: 'Create and edit custom admin roles',
    isElevated: false,
  },

  // ── VENDOR ─────────────────────────────────────────────
  {
    key: PERMISSIONS.VENDOR.PRODUCTS_VIEW,
    name: 'View Products',
    group: 'Products',
    scope: PermissionScope.VENDOR,
    description: 'View store products',
    isElevated: false,
  },
  {
    key: PERMISSIONS.VENDOR.PRODUCTS_CREATE,
    name: 'Create Products',
    group: 'Products',
    scope: PermissionScope.VENDOR,
    description: 'Create new products',
    isElevated: false,
  },
  {
    key: PERMISSIONS.VENDOR.PRODUCTS_EDIT,
    name: 'Edit Products',
    group: 'Products',
    scope: PermissionScope.VENDOR,
    description: 'Edit existing products and variants',
    isElevated: false,
  },
  {
    key: PERMISSIONS.VENDOR.PRODUCTS_DELETE,
    name: 'Delete Products',
    group: 'Products',
    scope: PermissionScope.VENDOR,
    description: 'Soft-delete products',
    isElevated: false,
  },
  {
    key: PERMISSIONS.VENDOR.INVENTORY_MANAGE,
    name: 'Manage Inventory',
    group: 'Inventory',
    scope: PermissionScope.VENDOR,
    description: 'Manage product inventory levels',
    isElevated: false,
  },
  {
    key: PERMISSIONS.VENDOR.MEDIA_UPLOAD,
    name: 'Upload Media',
    group: 'Media',
    scope: PermissionScope.VENDOR,
    description: 'List folders and upload media to the store library',
    isElevated: false,
  },
  {
    key: PERMISSIONS.VENDOR.MEDIA_DELETE,
    name: 'Delete Media',
    group: 'Media',
    scope: PermissionScope.VENDOR,
    description: 'Delete media files and folders',
    isElevated: false,
  },
  {
    key: PERMISSIONS.VENDOR.TEAM_MANAGE,
    name: 'Manage Team',
    group: 'Team',
    scope: PermissionScope.VENDOR,
    description: 'Invite and manage store team members',
    isElevated: false,
  },
  {
    key: PERMISSIONS.VENDOR.ROLES_MANAGE,
    name: 'Manage Roles',
    group: 'Team',
    scope: PermissionScope.VENDOR,
    description: 'Create and edit store custom roles',
    isElevated: false,
  },

  // ── PROFESSIONAL (scaffolding) ─────────────────────────
  {
    key: PERMISSIONS.PROFESSIONAL.TEAM_MANAGE,
    name: 'Manage Team',
    group: 'Team',
    scope: PermissionScope.PROFESSIONAL,
    description: 'Invite and manage profile team members',
    isElevated: false,
  },
  {
    key: PERMISSIONS.PROFESSIONAL.ROLES_MANAGE,
    name: 'Manage Roles',
    group: 'Team',
    scope: PermissionScope.PROFESSIONAL,
    description: 'Create and edit professional custom roles',
    isElevated: false,
  },
];

export const PLATFORM_ADMIN_ROLE_NAME = 'Platform Admin';
export const OWNER_ROLE_NAME = 'Owner';
