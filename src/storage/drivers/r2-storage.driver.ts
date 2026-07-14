import { Injectable, NotImplementedException } from '@nestjs/common';
import { ReadStream } from 'fs';
import { SaveFileInput, StorageDriver } from '../storage-driver.interface';

@Injectable()
export class R2StorageDriver implements StorageDriver {
  save(input: SaveFileInput): Promise<void> {
    void input;
    throw new NotImplementedException(
      'Cloudflare R2 storage is not implemented',
    );
  }

  delete(storageKey: string): Promise<void> {
    void storageKey;
    throw new NotImplementedException(
      'Cloudflare R2 storage is not implemented',
    );
  }

  getUrl(storageKey: string): string {
    void storageKey;
    throw new NotImplementedException(
      'Cloudflare R2 storage is not implemented',
    );
  }

  getReadStream(storageKey: string): ReadStream {
    void storageKey;
    throw new NotImplementedException(
      'Cloudflare R2 storage is not implemented',
    );
  }
}
