import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediaAccessLevel } from '../../../generated/prisma/client.js';
import {
  PutObjectInput,
  StorageDriverClient,
} from './storage-driver.interface';

@Injectable()
export class R2StorageDriver implements StorageDriverClient {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;

  constructor(private readonly config: ConfigService) {
    const endpoint =
      this.config.get<string>('R2_ENDPOINT') ??
      `https://${this.config.getOrThrow<string>('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`;

    this.bucket = this.config.getOrThrow<string>('R2_BUCKET');
    this.publicBaseUrl = this.config.getOrThrow<string>('R2_PUBLIC_BASE_URL');
    this.client = new S3Client({
      region: this.config.get<string>('R2_REGION', 'auto'),
      endpoint,
      credentials: {
        accessKeyId: this.config.getOrThrow<string>('R2_ACCESS_KEY_ID'),
        secretAccessKey: this.config.getOrThrow<string>('R2_SECRET_ACCESS_KEY'),
      },
    });
  }

  async putObject(input: PutObjectInput) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.buffer,
        ContentType: input.mimeType,
      }),
    );
  }

  async getObject(key: string) {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const bytes = await response.Body?.transformToByteArray();
    return Buffer.from(bytes ?? []);
  }

  async deleteObject(key: string) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async getUrl(key: string, accessLevel: MediaAccessLevel) {
    if (accessLevel === MediaAccessLevel.SIGNED) {
      return getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        { expiresIn: 60 * 15 },
      );
    }

    // PRIVATE currently follows PUBLIC URL behavior until private R2 policies are finalized.
    const encodedKey = key
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/');
    return `${this.publicBaseUrl.replace(/\/$/, '')}/${encodedKey}`;
  }
}
