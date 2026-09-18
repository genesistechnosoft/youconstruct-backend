/**
 * Copy local `uploads/` objects to R2 using the same keys, then stamp
 * media.storageDriver = R2 and rewrite KYC fileUrl snapshots.
 *
 * Requires STORAGE_DRIVER-independent R2_* env vars and DATABASE_URL.
 *
 * Usage:
 *   pnpm media:migrate-r2
 *   pnpm media:migrate-r2 -- --dry-run
 */
import 'dotenv/config';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaPg } from '@prisma/adapter-pg';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';
import { Pool } from 'pg';
import { PrismaClient, StorageDriver } from '../generated/prisma/client.js';

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.pdf': 'application/pdf',
};

const CONCURRENCY = 8;

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function mimeForKey(key: string) {
  return MIME_BY_EXT[extname(key).toLowerCase()] ?? 'application/octet-stream';
}

function toPosixKey(filePath: string, uploadRoot: string) {
  return relative(uploadRoot, filePath).split(sep).join('/');
}

function encodeKey(key: string) {
  return key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function publicUrl(baseUrl: string, key: string) {
  return `${baseUrl.replace(/\/$/, '')}/${encodeKey(key)}`;
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        return listFiles(fullPath);
      }
      if (entry.isFile()) {
        return [fullPath];
      }
      return [];
    }),
  );
  return nested.flat();
}

async function mapPool<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const uploadRoot = process.env.LOCAL_UPLOAD_ROOT ?? 'uploads';
  const accountId = requiredEnv('R2_ACCOUNT_ID');
  const bucket = requiredEnv('R2_BUCKET');
  const publicBaseUrl = requiredEnv('R2_PUBLIC_BASE_URL');
  const endpoint =
    process.env.R2_ENDPOINT ?? `https://${accountId}.r2.cloudflarestorage.com`;

  const files = await listFiles(uploadRoot);
  if (files.length === 0) {
    throw new Error(`No files found under ${uploadRoot}`);
  }

  console.log(
    `migrate_r2 dryRun=${dryRun} files=${files.length} bucket=${bucket} root=${uploadRoot}`,
  );

  const client = new S3Client({
    region: process.env.R2_REGION ?? 'auto',
    endpoint,
    credentials: {
      accessKeyId: requiredEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requiredEnv('R2_SECRET_ACCESS_KEY'),
    },
  });

  let uploaded = 0;
  let skipped = 0;
  const failures: string[] = [];

  await mapPool(files, CONCURRENCY, async (filePath, index) => {
    const key = toPosixKey(filePath, uploadRoot);
    const fileStat = await stat(filePath);
    const mimeType = mimeForKey(key);

    if (dryRun) {
      skipped += 1;
      if (index < 5) {
        console.log(`dry_run key=${key} bytes=${fileStat.size} mime=${mimeType}`);
      }
      return;
    }

    try {
      try {
        const existing = await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: key }),
        );
        if (existing.ContentLength === fileStat.size) {
          skipped += 1;
          return;
        }
      } catch {
        // missing object — upload
      }

      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: createReadStream(filePath),
          ContentType: mimeType,
          ContentLength: fileStat.size,
        }),
      );
      uploaded += 1;
      if (uploaded % 50 === 0 || uploaded + skipped === files.length) {
        console.log(
          `progress uploaded=${uploaded} skipped=${skipped} failed=${failures.length} of ${files.length}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${key}: ${message}`);
    }
  });

  const pool = new Pool({ connectionString: requiredEnv('DATABASE_URL') });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    if (!dryRun && failures.length === 0) {
      const mediaResult = await prisma.media.updateMany({
        where: { storageDriver: StorageDriver.LOCAL },
        data: { storageDriver: StorageDriver.R2 },
      });

      const kycDocs = await prisma.kycDocument.findMany({
        where: { mediaId: { not: null } },
        select: {
          id: true,
          media: { select: { originalKey: true } },
        },
      });

      let kycUpdated = 0;
      for (const doc of kycDocs) {
        if (!doc.media?.originalKey) {
          continue;
        }
        await prisma.kycDocument.update({
          where: { id: doc.id },
          data: { fileUrl: publicUrl(publicBaseUrl, doc.media.originalKey) },
        });
        kycUpdated += 1;
      }

      console.log(
        `db mediaDriverUpdated=${mediaResult.count} kycFileUrlUpdated=${kycUpdated}`,
      );
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }

  console.log(
    `done uploaded=${uploaded} skipped=${skipped} failed=${failures.length}`,
  );
  if (failures.length > 0) {
    for (const failure of failures.slice(0, 20)) {
      console.error(failure);
    }
    throw new Error(`R2 migrate failed for ${failures.length} file(s)`);
  }

  if (!dryRun && files[0]) {
    const sampleKey = toPosixKey(files[0], uploadRoot);
    console.log(`sample_url ${publicUrl(publicBaseUrl, sampleKey)}`);
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
