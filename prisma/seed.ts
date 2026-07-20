import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import {
  AuthProvider,
  PermissionScope,
  PlatformRole,
  PrismaClient,
  VendorOnboardingStatus,
} from '../generated/prisma/client.js';
import {
  OWNER_ROLE_NAME,
  PERMISSION_CATALOG,
  PERMISSIONS,
  PLATFORM_ADMIN_ROLE_NAME,
} from '../src/modules/rbac/permissions.constants';

const DEFAULT_PASSWORD = 'Password@123';

function assertSeedAllowed() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run demo seed in production');
  }

  if (process.env.SEED_ALLOW_DEV_RESET !== 'true') {
    throw new Error(
      'Set SEED_ALLOW_DEV_RESET=true to run the destructive dev/demo seed',
    );
  }
}

const units = [
  { code: 'PCS', symbol: 'Pcs', name: 'Piece', type: 'COUNT' },
  { code: 'BOX', symbol: 'Box', name: 'Box', type: 'COUNT' },
  { code: 'ROLL', symbol: 'Roll', name: 'Roll', type: 'COUNT' },
  { code: 'BUNDLE', symbol: 'Bundle', name: 'Bundle', type: 'COUNT' },
  { code: 'KG', symbol: 'Kg', name: 'Kilogram', type: 'WEIGHT' },
  { code: 'GRAM', symbol: 'g', name: 'Gram', type: 'WEIGHT' },
  { code: 'LITER', symbol: 'L', name: 'Litre', type: 'VOLUME' },
  { code: 'SQFT', symbol: 'Sq. Ft.', name: 'Square Feet', type: 'AREA' },
  { code: 'SQMT', symbol: 'Sq. Mt.', name: 'Square Meter', type: 'AREA' },
  { code: 'METER', symbol: 'Mtr', name: 'Meter', type: 'LENGTH' },
] as const;

const brands = [
  { name: 'Asian Paints', slug: 'asian-paints' },
  { name: 'Berger Paints', slug: 'berger-paints' },
  { name: 'UltraTech', slug: 'ultratech' },
  { name: 'Ambuja Cement', slug: 'ambuja-cement' },
  { name: 'JSW Steel', slug: 'jsw-steel' },
  { name: 'Tata Steel', slug: 'tata-steel' },
  { name: 'Havells', slug: 'havells' },
  { name: 'Anchor', slug: 'anchor' },
  { name: 'Kajaria', slug: 'kajaria' },
  { name: 'Somany', slug: 'somany' },
  { name: 'Greenply', slug: 'greenply' },
  { name: 'CenturyPly', slug: 'centuryply' },
  { name: 'Jaguar', slug: 'jaguar' },
  { name: 'Hindware', slug: 'hindware' },
  { name: 'Cera', slug: 'cera' },
] as const;

type CategorySeed = {
  name: string;
  slug: string;
  description: string;
  sortOrder: number;
  children?: Omit<CategorySeed, 'children'>[];
};

const categories: CategorySeed[] = [
  {
    name: 'Building Materials',
    slug: 'building-materials',
    description: 'Cement, steel, bricks, and structural essentials',
    sortOrder: 1,
    children: [
      {
        name: 'Cement & Concrete',
        slug: 'cement-concrete',
        description: 'OPC, PPC, ready-mix and binders',
        sortOrder: 1,
      },
      {
        name: 'Steel & TMT Bars',
        slug: 'steel-tmt-bars',
        description: 'TMT bars, structural steel and wire',
        sortOrder: 2,
      },
      {
        name: 'Bricks & Blocks',
        slug: 'bricks-blocks',
        description: 'Clay bricks, AAC and solid blocks',
        sortOrder: 3,
      },
    ],
  },
  {
    name: 'Electrical',
    slug: 'electrical',
    description: 'Wiring, switches, lighting and fixtures',
    sortOrder: 2,
    children: [
      {
        name: 'Wires & Cables',
        slug: 'wires-cables',
        description: 'House wiring and industrial cables',
        sortOrder: 1,
      },
      {
        name: 'Switches & Sockets',
        slug: 'switches-sockets',
        description: 'Modular switches and outlets',
        sortOrder: 2,
      },
      {
        name: 'Lighting',
        slug: 'lighting',
        description: 'LED panels, bulbs and decorative lights',
        sortOrder: 3,
      },
    ],
  },
  {
    name: 'Plumbing',
    slug: 'plumbing',
    description: 'Pipes, fittings and sanitaryware',
    sortOrder: 3,
    children: [
      {
        name: 'Pipes & Fittings',
        slug: 'pipes-fittings',
        description: 'CPVC, UPVC and GI plumbing',
        sortOrder: 1,
      },
      {
        name: 'Bath Fittings',
        slug: 'bath-fittings',
        description: 'Faucets, showers and mixers',
        sortOrder: 2,
      },
      {
        name: 'Sanitaryware',
        slug: 'sanitaryware',
        description: 'Wash basins, closets and cisterns',
        sortOrder: 3,
      },
    ],
  },
  {
    name: 'Paints & Finishes',
    slug: 'paints-finishes',
    description: 'Interior and exterior paints, primers and coatings',
    sortOrder: 4,
    children: [
      {
        name: 'Interior Paints',
        slug: 'interior-paints',
        description: 'Emulsions and wall finishes',
        sortOrder: 1,
      },
      {
        name: 'Exterior Paints',
        slug: 'exterior-paints',
        description: 'Weatherproof exterior coatings',
        sortOrder: 2,
      },
      {
        name: 'Wood & Metal Finishes',
        slug: 'wood-metal-finishes',
        description: 'Enamels, primers and polishes',
        sortOrder: 3,
      },
    ],
  },
  {
    name: 'Tiles & Flooring',
    slug: 'tiles-flooring',
    description: 'Floor and wall tiles, laminates and vinyl',
    sortOrder: 5,
    children: [
      {
        name: 'Floor Tiles',
        slug: 'floor-tiles',
        description: 'Vitrified and ceramic floor tiles',
        sortOrder: 1,
      },
      {
        name: 'Wall Tiles',
        slug: 'wall-tiles',
        description: 'Bathroom and bathroom wall tiles',
        sortOrder: 2,
      },
      {
        name: 'Laminates & Vinyl',
        slug: 'laminates-vinyl',
        description: 'Laminate flooring and vinyl sheets',
        sortOrder: 3,
      },
    ],
  },
  {
    name: 'Wood & Interiors',
    slug: 'wood-interiors',
    description: 'Plywood, laminates and interior materials',
    sortOrder: 6,
    children: [
      {
        name: 'Plywood & Boards',
        slug: 'plywood-boards',
        description: 'Marine ply, MDF and particle boards',
        sortOrder: 1,
      },
      {
        name: 'Laminates & Veneers',
        slug: 'laminates-veneers',
        description: 'Decorative laminates and veneers',
        sortOrder: 2,
      },
      {
        name: 'Hardware & Fittings',
        slug: 'hardware-fittings',
        description: 'Hinges, channels and handles',
        sortOrder: 3,
      },
    ],
  },
];

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function seedUnits() {
  for (const unit of units) {
    await prisma.unit.upsert({
      where: { code: unit.code },
      update: {
        symbol: unit.symbol,
        name: unit.name,
        type: unit.type,
      },
      create: unit,
    });
  }

  console.log(`Seeded ${units.length} units`);
}

async function seedBrands() {
  for (const brand of brands) {
    await prisma.brand.upsert({
      where: { slug: brand.slug },
      update: {
        name: brand.name,
        isActive: true,
        deletedAt: null,
      },
      create: {
        name: brand.name,
        slug: brand.slug,
        isActive: true,
      },
    });
  }

  console.log(`Seeded ${brands.length} brands`);
}

async function upsertCategory(
  category: Omit<CategorySeed, 'children'>,
  parentId: string | null,
) {
  return prisma.category.upsert({
    where: { slug: category.slug },
    update: {
      name: category.name,
      description: category.description,
      parentId,
      sortOrder: category.sortOrder,
      isActive: true,
      deletedAt: null,
    },
    create: {
      name: category.name,
      slug: category.slug,
      description: category.description,
      parentId,
      sortOrder: category.sortOrder,
      isActive: true,
    },
  });
}

async function seedCategories() {
  let count = 0;

  for (const parent of categories) {
    const parentCategory = await upsertCategory(parent, null);
    count += 1;

    for (const child of parent.children ?? []) {
      await upsertCategory(child, parentCategory.id);
      count += 1;
    }
  }

  console.log(`Seeded ${count} categories`);
}

async function seedPermissions() {
  for (const permission of PERMISSION_CATALOG) {
    await prisma.permission.upsert({
      where: {
        scope_key: {
          scope: permission.scope,
          key: permission.key,
        },
      },
      update: {
        name: permission.name,
        group: permission.group,
        description: permission.description,
        isElevated: permission.isElevated,
      },
      create: {
        key: permission.key,
        name: permission.name,
        group: permission.group,
        scope: permission.scope,
        description: permission.description,
        isElevated: permission.isElevated,
      },
    });
  }

  const catalogPairs = PERMISSION_CATALOG.map((p) => ({
    scope: p.scope,
    key: p.key,
  }));

  await prisma.rolePermission.deleteMany({
    where: {
      permission: {
        NOT: {
          OR: catalogPairs,
        },
      },
    },
  });
  await prisma.permission.deleteMany({
    where: {
      NOT: {
        OR: catalogPairs,
      },
    },
  });

  console.log(`Seeded ${PERMISSION_CATALOG.length} permissions`);
}

async function seedPlatformAdminRole() {
  const existing = await prisma.customRole.findFirst({
    where: {
      name: PLATFORM_ADMIN_ROLE_NAME,
      scope: PermissionScope.ADMIN,
      scopeEntityId: null,
      deletedAt: null,
    },
    select: { id: true },
  });

  const role =
    existing ??
    (await prisma.customRole.create({
      data: {
        name: PLATFORM_ADMIN_ROLE_NAME,
        scope: PermissionScope.ADMIN,
        scopeEntityId: null,
        // Only business Owner is a system role; Platform Admin uses DB grants
        isSystem: false,
      },
      select: { id: true },
    }));

  if (existing) {
    await prisma.customRole.update({
      where: { id: existing.id },
      data: { isSystem: false },
    });
  }

  // Non-elevated only — Super Admin grants elevated perms explicitly
  const adminPermissions = await prisma.permission.findMany({
    where: { scope: PermissionScope.ADMIN, isElevated: false },
    select: { id: true },
  });

  const allowedIds = new Set(adminPermissions.map((p) => p.id));

  await prisma.rolePermission.deleteMany({
    where: {
      customRoleId: role.id,
      permissionId: { notIn: [...allowedIds] },
    },
  });

  for (const permission of adminPermissions) {
    await prisma.rolePermission.upsert({
      where: {
        customRoleId_permissionId: {
          customRoleId: role.id,
          permissionId: permission.id,
        },
      },
      update: {},
      create: {
        customRoleId: role.id,
        permissionId: permission.id,
      },
    });
  }

  console.log(`Seeded platform role template: ${PLATFORM_ADMIN_ROLE_NAME}`);
  return role;
}

function shouldResetPasswords() {
  return process.env.SEED_RESET_PASSWORDS === 'true';
}

async function seedSuperAdmin(passwordHash: string) {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@youconstruct.com';
  const phone = process.env.SEED_ADMIN_PHONE ?? '9000000001';

  const admin = await prisma.user.upsert({
    where: { email },
    update: {
      name: 'Default Super Admin',
      phone,
      ...(shouldResetPasswords() ? { passwordHash } : {}),
      platformRole: PlatformRole.SUPER_ADMIN,
      provider: AuthProvider.EMAIL,
      isEmailVerified: true,
      isPhoneVerified: true,
      isActive: true,
      deletedAt: null,
    },
    create: {
      name: 'Default Super Admin',
      email,
      phone,
      passwordHash,
      platformRole: PlatformRole.SUPER_ADMIN,
      provider: AuthProvider.EMAIL,
      isEmailVerified: true,
      isPhoneVerified: true,
      isActive: true,
    },
  });

  console.log(`Seeded super admin: ${admin.email}`);
  return admin;
}

async function seedApprovedVendor(passwordHash: string) {
  const email = process.env.SEED_VENDOR_EMAIL ?? 'vendor@youconstruct.com';
  const phone = process.env.SEED_VENDOR_PHONE ?? '9000000002';
  const now = new Date();

  const vendorUser = await prisma.user.upsert({
    where: { email },
    update: {
      name: 'Default Vendor',
      phone,
      ...(shouldResetPasswords() ? { passwordHash } : {}),
      platformRole: PlatformRole.VENDOR,
      provider: AuthProvider.EMAIL,
      isEmailVerified: true,
      isPhoneVerified: true,
      isActive: true,
      deletedAt: null,
    },
    create: {
      name: 'Default Vendor',
      email,
      phone,
      passwordHash,
      platformRole: PlatformRole.VENDOR,
      provider: AuthProvider.EMAIL,
      isEmailVerified: true,
      isPhoneVerified: true,
      isActive: true,
    },
  });

  const vendorProfile = await prisma.vendorProfile.upsert({
    where: { userId: vendorUser.id },
    update: {
      businessName: 'YouConstruct Demo Stores',
      businessAddress: '42 Market Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
      gstNumber: '29AAAAA0000A1Z5',
      isApproved: true,
      approvedAt: now,
      onboardingStatus: VendorOnboardingStatus.APPROVED,
      submittedAt: now,
      reviewedAt: now,
      rejectionReason: null,
      deletedAt: null,
    },
    create: {
      userId: vendorUser.id,
      businessName: 'YouConstruct Demo Stores',
      businessAddress: '42 Market Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
      gstNumber: '29AAAAA0000A1Z5',
      isApproved: true,
      approvedAt: now,
      onboardingStatus: VendorOnboardingStatus.APPROVED,
      submittedAt: now,
      reviewedAt: now,
    },
  });

  await prisma.vendorWallet.upsert({
    where: { vendorId: vendorProfile.id },
    update: {},
    create: { vendorId: vendorProfile.id },
  });

  await prisma.vendorMembership.upsert({
    where: { vendorId: vendorProfile.id },
    update: {},
    create: { vendorId: vendorProfile.id },
  });

  await prisma.vendorStoreSettings.upsert({
    where: { vendorId: vendorProfile.id },
    update: {},
    create: { vendorId: vendorProfile.id },
  });

  await ensureOwnerRoleSeed(
    PermissionScope.VENDOR,
    vendorProfile.id,
    vendorUser.id,
  );

  console.log(`Seeded approved vendor: ${vendorUser.email}`);
  return { vendorUser, vendorProfile };
}

async function ensureOwnerRoleSeed(
  scope: PermissionScope,
  scopeEntityId: string,
  userId: string,
) {
  let role = await prisma.customRole.findFirst({
    where: {
      name: OWNER_ROLE_NAME,
      scope,
      scopeEntityId,
      isSystem: true,
      deletedAt: null,
    },
    select: { id: true },
  });

  if (!role) {
    role = await prisma.customRole.create({
      data: {
        name: OWNER_ROLE_NAME,
        scope,
        scopeEntityId,
        isSystem: true,
      },
      select: { id: true },
    });
  }

  const permissions = await prisma.permission.findMany({
    where: { scope },
    select: { id: true },
  });

  for (const permission of permissions) {
    await prisma.rolePermission.upsert({
      where: {
        customRoleId_permissionId: {
          customRoleId: role.id,
          permissionId: permission.id,
        },
      },
      update: {},
      create: {
        customRoleId: role.id,
        permissionId: permission.id,
      },
    });
  }

  const existingMember = await prisma.teamMember.findFirst({
    where: { userId, scope, scopeEntityId, deletedAt: null },
    select: { id: true },
  });

  if (!existingMember) {
    await prisma.teamMember.create({
      data: {
        userId,
        customRoleId: role.id,
        scope,
        scopeEntityId,
      },
    });
  }

  console.log(`Seeded Owner role for ${scope} entity ${scopeEntityId}`);
}

async function seedVendorStaff(passwordHash: string, vendorProfileId: string) {
  const email =
    process.env.SEED_VENDOR_STAFF_EMAIL ?? 'vendor-staff@youconstruct.com';
  const phone = process.env.SEED_VENDOR_STAFF_PHONE ?? '9000000004';

  const staffUser = await prisma.user.upsert({
    where: { email },
    update: {
      name: 'Demo Vendor Staff',
      phone,
      ...(shouldResetPasswords() ? { passwordHash } : {}),
      platformRole: PlatformRole.VENDOR,
      provider: AuthProvider.EMAIL,
      isEmailVerified: true,
      isPhoneVerified: true,
      isActive: true,
      deletedAt: null,
    },
    create: {
      name: 'Demo Vendor Staff',
      email,
      phone,
      passwordHash,
      platformRole: PlatformRole.VENDOR,
      provider: AuthProvider.EMAIL,
      isEmailVerified: true,
      isPhoneVerified: true,
      isActive: true,
    },
  });

  const productPerms = await prisma.permission.findMany({
    where: {
      scope: PermissionScope.VENDOR,
      key: {
        in: [
          PERMISSIONS.VENDOR.PRODUCTS_VIEW,
          PERMISSIONS.VENDOR.PRODUCTS_CREATE,
          PERMISSIONS.VENDOR.PRODUCTS_EDIT,
          PERMISSIONS.VENDOR.INVENTORY_MANAGE,
          PERMISSIONS.VENDOR.MEDIA_UPLOAD,
          PERMISSIONS.VENDOR.STORE_SETTINGS,
          PERMISSIONS.VENDOR.MEMBERSHIP_VIEW,
          PERMISSIONS.VENDOR.SHIPPING_MANAGE,
          PERMISSIONS.VENDOR.WALLET_VIEW,
          PERMISSIONS.VENDOR.BANK_MANAGE,
          PERMISSIONS.VENDOR.PAYOUTS_REQUEST,
        ],
      },
    },
    select: { id: true },
  });

  let storeManager = await prisma.customRole.findFirst({
    where: {
      name: 'Store Manager',
      scope: PermissionScope.VENDOR,
      scopeEntityId: vendorProfileId,
      deletedAt: null,
    },
    select: { id: true },
  });

  if (!storeManager) {
    storeManager = await prisma.customRole.create({
      data: {
        name: 'Store Manager',
        scope: PermissionScope.VENDOR,
        scopeEntityId: vendorProfileId,
        isSystem: false,
        rolePermissions: {
          create: productPerms.map((permission) => ({
            permissionId: permission.id,
          })),
        },
      },
      select: { id: true },
    });
  } else {
    const allowedIds = new Set(productPerms.map((p) => p.id));
    await prisma.rolePermission.deleteMany({
      where: {
        customRoleId: storeManager.id,
        permissionId: { notIn: [...allowedIds] },
      },
    });
    for (const permission of productPerms) {
      await prisma.rolePermission.upsert({
        where: {
          customRoleId_permissionId: {
            customRoleId: storeManager.id,
            permissionId: permission.id,
          },
        },
        update: {},
        create: {
          customRoleId: storeManager.id,
          permissionId: permission.id,
        },
      });
    }
  }

  const existing = await prisma.teamMember.findFirst({
    where: {
      userId: staffUser.id,
      deletedAt: null,
    },
    select: { id: true },
  });

  if (!existing) {
    await prisma.teamMember.create({
      data: {
        userId: staffUser.id,
        customRoleId: storeManager.id,
        scope: PermissionScope.VENDOR,
        scopeEntityId: vendorProfileId,
      },
    });
  }

  console.log(`Seeded vendor staff (no profile): ${staffUser.email}`);
  return staffUser;
}

async function seedPlatformAdminStaff(
  passwordHash: string,
  platformAdminRoleId: string,
) {
  const email = process.env.SEED_STAFF_EMAIL ?? 'staff@youconstruct.com';
  const phone = process.env.SEED_STAFF_PHONE ?? '9000000003';

  const staff = await prisma.user.upsert({
    where: { email },
    update: {
      name: 'Default Platform Admin',
      phone,
      ...(shouldResetPasswords() ? { passwordHash } : {}),
      platformRole: PlatformRole.ADMIN,
      provider: AuthProvider.EMAIL,
      isEmailVerified: true,
      isPhoneVerified: true,
      isActive: true,
      deletedAt: null,
    },
    create: {
      name: 'Default Platform Admin',
      email,
      phone,
      passwordHash,
      platformRole: PlatformRole.ADMIN,
      provider: AuthProvider.EMAIL,
      isEmailVerified: true,
      isPhoneVerified: true,
      isActive: true,
    },
  });

  const existing = await prisma.teamMember.findFirst({
    where: {
      userId: staff.id,
      scope: PermissionScope.ADMIN,
      scopeEntityId: null,
      deletedAt: null,
    },
    select: { id: true },
  });

  if (!existing) {
    await prisma.teamMember.create({
      data: {
        userId: staff.id,
        customRoleId: platformAdminRoleId,
        scope: PermissionScope.ADMIN,
        scopeEntityId: null,
      },
    });
  }

  console.log(`Seeded platform admin staff: ${staff.email}`);
  return staff;
}

async function main() {
  assertSeedAllowed();

  const password = process.env.SEED_DEFAULT_PASSWORD ?? DEFAULT_PASSWORD;
  if (password === DEFAULT_PASSWORD && process.env.NODE_ENV !== 'development') {
    throw new Error(
      'SEED_DEFAULT_PASSWORD must be set outside local development',
    );
  }

  const passwordHash = await bcrypt.hash(password, 10);

  await seedUnits();
  await seedBrands();
  await seedCategories();
  await seedPermissions();
  const platformAdminRole = await seedPlatformAdminRole();
  await seedSuperAdmin(passwordHash);
  await seedPlatformAdminStaff(passwordHash, platformAdminRole.id);
  const { vendorProfile } = await seedApprovedVendor(passwordHash);
  await seedVendorStaff(passwordHash, vendorProfile.id);

  console.log(`Default password for seeded users: ${password}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    await pool.end();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  });
