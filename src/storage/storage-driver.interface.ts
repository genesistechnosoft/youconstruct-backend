import { ReadStream } from 'fs';

export interface SaveFileInput {
  buffer: Buffer;
  storageKey: string;
  visibility: 'public' | 'private';
}

export interface StorageDriver {
  save(input: SaveFileInput): Promise<void>;
  delete(storageKey: string): Promise<void>;
  getUrl(storageKey: string): string;
  getReadStream(storageKey: string): ReadStream;
}
