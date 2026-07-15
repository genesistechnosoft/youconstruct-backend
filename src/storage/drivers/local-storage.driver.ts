import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { MediaAccessLevel } from '../../../generated/prisma/client.js';
import {
  PutObjectInput,
  StorageDriverClient,
} from './storage-driver.interface';

@Injectable()
export class LocalStorageDriver implements StorageDriverClient {
  private readonly uploadRoot: string;
  private readonly publicBaseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.uploadRoot = this.config.get<string>('LOCAL_UPLOAD_ROOT', 'uploads');
    this.publicBaseUrl = this.config.get<string>(
      'LOCAL_UPLOAD_PUBLIC_URL',
      'http://localhost:3000/uploads',
    );
  }

  async putObject(input: PutObjectInput) {
    const path = this.getSafePath(input.key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, input.buffer);
  }

  async getObject(key: string) {
    return readFile(this.getSafePath(key));
  }

  async deleteObject(key: string) {
    await unlink(this.getSafePath(key)).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      },
    );
  }

  getUrl(key: string, accessLevel: MediaAccessLevel) {
    void accessLevel;
    const encodedKey = key
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/');
    return Promise.resolve(
      `${this.publicBaseUrl.replace(/\/$/, '')}/${encodedKey}`,
    );
  }

  private getSafePath(key: string) {
    const normalized = normalize(key).replace(/^(\.\.[/\\])+/, '');
    return join(process.cwd(), this.uploadRoot, normalized);
  }
}
