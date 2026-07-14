import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream, ReadStream } from 'fs';
import { mkdir, rm, writeFile } from 'fs/promises';
import { dirname, join, normalize, resolve, sep } from 'path';
import { SaveFileInput, StorageDriver } from '../storage-driver.interface';

@Injectable()
export class LocalStorageDriver implements StorageDriver {
  private readonly publicRoot: string;
  private readonly privateRoot: string;
  private readonly publicBaseUrl: string;

  constructor(config: ConfigService) {
    this.publicRoot = resolve(
      config.get<string>('STORAGE_LOCAL_PUBLIC_PATH', './uploads/public'),
    );
    this.privateRoot = resolve(
      config.get<string>('STORAGE_LOCAL_PRIVATE_PATH', './uploads/private'),
    );
    this.publicBaseUrl = config
      .get<string>(
        'STORAGE_PUBLIC_BASE_URL',
        'http://localhost:3000/uploads/public',
      )
      .replace(/\/+$/, '');
  }

  async save(input: SaveFileInput): Promise<void> {
    const absolutePath = this.resolveStoragePath(
      input.storageKey,
      input.visibility,
    );
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, input.buffer);
  }

  async delete(storageKey: string): Promise<void> {
    const visibility = this.visibilityFromKey(storageKey);
    const absolutePath = this.resolveStoragePath(storageKey, visibility);
    await rm(absolutePath, { force: true });
  }

  getUrl(storageKey: string): string {
    const normalizedKey = this.normalizeStorageKey(storageKey);
    return `${this.publicBaseUrl}/${normalizedKey}`;
  }

  getReadStream(storageKey: string): ReadStream {
    const visibility = this.visibilityFromKey(storageKey);
    return createReadStream(this.resolveStoragePath(storageKey, visibility));
  }

  private resolveStoragePath(
    storageKey: string,
    visibility: 'public' | 'private',
  ) {
    const root = visibility === 'public' ? this.publicRoot : this.privateRoot;
    const normalizedKey = this.normalizeStorageKey(storageKey);
    const absolutePath = resolve(join(root, normalizedKey));

    if (absolutePath !== root && !absolutePath.startsWith(`${root}${sep}`)) {
      throw new BadRequestException('Invalid storage key');
    }

    return absolutePath;
  }

  private normalizeStorageKey(storageKey: string) {
    const normalizedKey = normalize(storageKey).replace(/\\/g, '/');
    if (
      normalizedKey.startsWith('../') ||
      normalizedKey.includes('/../') ||
      normalizedKey.startsWith('/') ||
      normalizedKey === '..'
    ) {
      throw new BadRequestException('Invalid storage key');
    }

    return normalizedKey;
  }

  private visibilityFromKey(storageKey: string): 'public' | 'private' {
    return storageKey.includes('/private/') ? 'private' : 'public';
  }
}
