import { MediaAccessLevel } from '../../../generated/prisma/client.js';

export interface PutObjectInput {
  key: string;
  buffer: Buffer;
  mimeType: string;
}

export interface StorageDriverClient {
  putObject(input: PutObjectInput): Promise<void>;
  getObject(key: string): Promise<Buffer>;
  deleteObject(key: string): Promise<void>;
  getUrl(key: string, accessLevel: MediaAccessLevel): Promise<string>;
}
