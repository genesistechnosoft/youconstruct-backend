/**
 * One-time SUPER_ADMIN bootstrap — safe for staging/production.
 * Never overwrites an existing user's password.
 *
 * Required env:
 *   BOOTSTRAP_SUPER_ADMIN=true
 *   BOOTSTRAP_ADMIN_EMAIL
 *   BOOTSTRAP_ADMIN_PASSWORD  (strong: 12+ chars, upper, lower, number, symbol)
 *   BOOTSTRAP_ADMIN_PHONE     (optional)
 *   DATABASE_URL
 */
import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import {
  AuthProvider,
  PlatformRole,
  PrismaClient,
} from '../generated/prisma/client.js';
import { PERMISSION_CATALOG } from '../src/modules/rbac/permissions.constants';

function assertBootstrapAllowed() {
  if (process.env.BOOTSTRAP_SUPER_ADMIN !== 'true') {
    throw new Error('Set BOOTSTRAP_SUPER_ADMIN=true to run this command');
  }
}

function assertStrongPassword(password: string) {
  const strong =
    password.length >= 12 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password);

  if (!strong) {
    throw new Error(
      'BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters and include upper, lower, number, and symbol',
    );
  }
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function syncPermissionCatalog() {
  for (const permission of PERMISSION_CATALOG) {
    await prisma.permission.upsert({
      where: {
        scope_key: { scope: permission.scope, key: permission.key },
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
}

async function main() {
  assertBootstrapAllowed();

  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const phone = process.env.BOOTSTRAP_ADMIN_PHONE ?? '9000000001';

  if (!email || !password) {
    throw new Error(
      'BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD are required',
    );
  }

  assertStrongPassword(password);
  await syncPermissionCatalog();

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, platformRole: true, passwordHash: true },
  });

  if (existing) {
    if (existing.platformRole !== PlatformRole.SUPER_ADMIN) {
      throw new Error(
        `User ${email} already exists with role ${existing.platformRole}; refusing to modify`,
      );
    }
    console.log(
      `SUPER_ADMIN already exists (${email}); password left unchanged`,
    );
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const admin = await prisma.user.create({
    data: {
      name: 'Super Admin',
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

  console.log(`Created SUPER_ADMIN: ${admin.email}`);
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
