/**
 * Standalone idempotent permission-sync script.
 *
 * Run via package script after each deploy:
 *
 *   pnpm run sync:permissions          # upsert only (safe, never deletes)
 *   pnpm run sync:permissions -- --prune  # upsert + delete stale rows with full logging
 *
 * Covers all scopes: ADMIN, VENDOR, PROFESSIONAL.
 *
 * Default behaviour (no flag):
 *   - Upserts every permission in PERMISSION_CATALOG.
 *   - Does NOT remove anything. Safe to run at any time.
 *
 * Prune behaviour (--prune flag):
 *   - Additionally removes role_permission grants whose permission is no longer
 *     in PERMISSION_CATALOG, then removes the stale permission rows themselves.
 *   - Every removed row is logged before deletion.
 *   - Stale-permission cleanup order:
 *       1. role_permissions grants first (FK-referencing side).
 *       2. permissions second.
 *     This order prevents FK constraint violations.
 *   - The removal of role_permission grants is intentional: any role that held a
 *     permission that no longer exists loses that grant. Re-grants must be applied
 *     deliberately (e.g. via seed or admin UI) after a prune.
 *
 * Exits with code 1 on error (causing deploy to fail).
 */
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { PERMISSION_CATALOG } from '../src/modules/rbac/permissions.constants.js';

const prune = process.argv.includes('--prune');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function syncPermissions() {
  let upserted = 0;

  // ── Upsert all catalog permissions ─────────────────────────────────────────
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
    upserted++;
  }

  console.log(`✓ Upserted ${upserted} permissions.`);

  if (!prune) {
    console.log(
      'ℹ Skipping stale-permission pruning (run with --prune to enable).',
    );
    return;
  }

  // ── Prune stale rows ────────────────────────────────────────────────────────
  const catalogPairs = PERMISSION_CATALOG.map((p) => ({
    scope: p.scope,
    key: p.key,
  }));

  // Step 1 — find and log stale role_permission grants before deleting
  const staleGrants = await prisma.rolePermission.findMany({
    where: {
      permission: {
        NOT: {
          OR: catalogPairs,
        },
      },
    },
    select: {
      id: true,
      customRoleId: true,
      permission: {
        select: { scope: true, key: true },
      },
    },
  });

  if (staleGrants.length > 0) {
    console.log(
      `⚠ Pruning ${staleGrants.length} stale role_permission grant(s):`,
    );
    for (const grant of staleGrants) {
      console.log(
        `  • role_permission id=${grant.id} customRoleId=${grant.customRoleId} ` +
          `permission=${grant.permission.scope}:${grant.permission.key}`,
      );
    }
  }

  const { count: deletedGrantCount } = await prisma.rolePermission.deleteMany({
    where: {
      permission: {
        NOT: {
          OR: catalogPairs,
        },
      },
    },
  });

  // Step 2 — find and log stale permissions before deleting
  const stalePerms = await prisma.permission.findMany({
    where: {
      NOT: {
        OR: catalogPairs,
      },
    },
    select: { id: true, scope: true, key: true, name: true },
  });

  if (stalePerms.length > 0) {
    console.log(`⚠ Pruning ${stalePerms.length} stale permission(s):`);
    for (const perm of stalePerms) {
      console.log(
        `  • permission id=${perm.id} ${perm.scope}:${perm.key} "${perm.name}"`,
      );
    }
  }

  const { count: deletedPermCount } = await prisma.permission.deleteMany({
    where: {
      NOT: {
        OR: catalogPairs,
      },
    },
  });

  console.log(
    `✓ Pruned ${deletedGrantCount} role-permission grant(s) and ${deletedPermCount} permission(s).`,
  );
}

syncPermissions()
  .then(async () => {
    await prisma.$disconnect();
    await pool.end();
  })
  .catch(async (error) => {
    console.error('✗ sync-permissions failed:', error);
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  });
