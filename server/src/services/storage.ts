import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../config/env.js';

export interface StoragePort {
  putPublic(key: string, body: Buffer, contentType: string): Promise<string>;
}

export const LOCAL_UPLOAD_DIR = join(process.cwd(), 'uploads');

class LocalStorage implements StoragePort {
  async putPublic(key: string, body: Buffer): Promise<string> {
    const path = join(LOCAL_UPLOAD_DIR, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    return `/files/${key}`;
  }
}

class R2Storage implements StoragePort {
  private client = new S3Client({
    region: 'auto',
    endpoint: env.R2_ENDPOINT,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID ?? '',
      secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? '',
    },
  });

  async putPublic(key: string, body: Buffer, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: key, Body: body, ContentType: contentType }),
    );
    return `${env.R2_PUBLIC_BASE_URL}/${key}`;
  }
}

export const storage: StoragePort = env.STORAGE_DRIVER === 'r2' ? new R2Storage() : new LocalStorage();

const EXT_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export function makeKey(prefix: string, contentType: string): string {
  const ext = EXT_BY_TYPE[contentType] ?? 'bin';
  return `${prefix}/${randomBytes(12).toString('hex')}.${ext}`;
}
