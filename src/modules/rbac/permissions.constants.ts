import { PermissionScope } from '../../../generated/prisma/client.js';

export const PERMISSIONS = {
  ADMIN: {
    VENDORS_VIEW: 'vendors:view',
    VENDORS_APPROVE: 'vendors:approve',
    VENDORS_REJECT: 'vendors:reject',
    VENDORS_MEMBERSHIP: 'vendors:membership',
    VENDORS_WALLET: 'vendors:wallet',
    PAYOUTS_MANAGE: 'payouts:manage',
    CATALOG_MANAGE: 'catalog:manage',
    ORDERS_VIEW: 'orders:view',
    ORDERS_MANAGE: 'orders:manage',
    USERS_IMPERSONATE: 'users:impersonate',
    TEAM_MANAGE: 'team:manage',
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
    STORE_SETTINGS: 'store:settings',
    MEMBERSHIP_VIEW: 'membership:view',
    SHIPPING_MANAGE: 'shipping:manage',
    ORDERS_VIEW: 'orders:view',
    ORDERS_MANAGE: 'orders:manage',
    WALLET_VIEW: 'wallet:view',
    BANK_MANAGE: 'bank:manage',
    PAYOUTS_REQUEST: 'payouts:request',
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
    key: PERMISSIONS.ADMIN.VENDORS_MEMBERSHIP,
    name: 'Manage Vendor Membership',
    group: 'Vendors',
    scope: PermissionScope.ADMIN,
    description: 'Update vendor plan, storage limits, and product limits',
    isElevated: false,
  },
  {
    key: PERMISSIONS.ADMIN.VENDORS_WALLET,
    name: 'View Vendor Wallet',
    group: 'Vendors',
    scope: PermissionScope.ADMIN,
    description:
      'View vendor wallet, transactions, and verify vendor bank accounts',
    isElevated: false,
  },
  {
    key: PERMISSIONS.ADMIN.PAYOUTS_MANAGE,
    name: 'Manage Payouts',
    group: 'Finance',
    scope: PermissionScope.ADMIN,
    description: 'Process, complete, and fail vendor payout requests',
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
    key: PERMISSIONS.ADMIN.ORDERS_VIEW,
    name: 'View Orders',
    group: 'Orders',
    scope: PermissionScope.ADMIN,
    description: 'View customer orders and sub-orders across vendors',
    isElevated: false,
  },
  {
    key: PERMISSIONS.ADMIN.ORDERS_MANAGE,
    name: 'Manage Orders',
    group: 'Orders',
    scope: PermissionScope.ADMIN,
    description: 'Update order status, shipments, and refund stubs',
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
    key: PERMISSIONS.ADMIN.TEAM_MANAGE,
    name: 'Manage Team',
    group: 'Team',
    scope: PermissionScope.ADMIN,
    description: 'Invite platform staff and manage admin team memberships',
    isElevated: false,
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
    key: PERMISSIONS.VENDOR.STORE_SETTINGS,
    name: 'Manage Store Settings',
    group: 'Store',
    scope: PermissionScope.VENDOR,
    description:
      'Manage store policies, SEO, social links, and support contact',
    isElevated: false,
  },
  {
    key: PERMISSIONS.VENDOR.MEMBERSHIP_VIEW,
    name: 'View Membership',
    group: 'Store',
    scope: PermissionScope.VENDOR,
    description: 'View store plan, storage usage, and product limits',
    isElevated: false,
  },
  {
    key: PERMISSIONS.VENDOR.SHIPPING_MANAGE,
    name: 'Manage Shipping',
    group: 'Store',
    scope: PermissionScope.VENDOR,
    description: 'Configure store shipping methods and product overrides',
    isElevated: false,
  },
  {
    key: PERMISSIONS.VENDOR.ORDERS_VIEW,
    name: 'View Orders',
    group: 'Orders',
    scope: PermissionScope.VENDOR,
    description: 'View store sub-orders and shipment status',
    isElevated: false,
  },
  {
    key: PERMISSIONS.VENDOR.ORDERS_MANAGE,
    name: 'Manage Orders',
    group: 'Orders',
    scope: PermissionScope.VENDOR,
    description: 'Update sub-order status and shipment tracking',
    isElevated: false,
  },
  {
    key: PERMISSIONS.VENDOR.WALLET_VIEW,
    name: 'View Wallet',
    group: 'Finance',
    scope: PermissionScope.VENDOR,
    description: 'View wallet balance and transaction history',
    isElevated: false,
  },
  {
    key: PERMISSIONS.VENDOR.BANK_MANAGE,
    name: 'Manage Bank Account',
    group: 'Finance',
    scope: PermissionScope.VENDOR,
    description: 'Add and update the store payout bank account',
    isElevated: false,
  },
  {
    key: PERMISSIONS.VENDOR.PAYOUTS_REQUEST,
    name: 'Request Payout',
    group: 'Finance',
    scope: PermissionScope.VENDOR,
    description: 'Request withdrawal of available wallet balance',
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
export const SUPPORT_AGENT_ROLE_NAME = 'Support Agent';
export const OWNER_ROLE_NAME = 'Owner';
