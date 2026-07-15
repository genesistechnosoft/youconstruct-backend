import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import {
  AuthProvider,
  PrismaClient,
  UserRole,
  VendorOnboardingStatus,
} from '../generated/prisma/client.js';

const DEFAULT_PASSWORD = 'Password@123';

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

async function seedAdmin(passwordHash: string) {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@youconstruct.com';
  const phone = process.env.SEED_ADMIN_PHONE ?? '9000000001';

  const admin = await prisma.user.upsert({
    where: { email },
    update: {
      name: 'Default Admin',
      phone,
      passwordHash,
      role: UserRole.ADMIN,
      provider: AuthProvider.EMAIL,
      isEmailVerified: true,
      isPhoneVerified: true,
      isActive: true,
      deletedAt: null,
    },
    create: {
      name: 'Default Admin',
      email,
      phone,
      passwordHash,
      role: UserRole.ADMIN,
      provider: AuthProvider.EMAIL,
      isEmailVerified: true,
      isPhoneVerified: true,
      isActive: true,
    },
  });

  console.log(`Seeded admin: ${admin.email}`);
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
      passwordHash,
      role: UserRole.VENDOR,
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
      role: UserRole.VENDOR,
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

  console.log(`Seeded approved vendor: ${vendorUser.email}`);
  return vendorUser;
}

async function main() {
  const password = process.env.SEED_DEFAULT_PASSWORD ?? DEFAULT_PASSWORD;
  const passwordHash = await bcrypt.hash(password, 10);

  await seedUnits();
  await seedBrands();
  await seedCategories();
  await seedAdmin(passwordHash);
  await seedApprovedVendor(passwordHash);

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
