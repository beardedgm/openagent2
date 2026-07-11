import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env.js';

/** Where a protected download lives: a presigned URL (R2) or a disk path to stream (local). */
export type DownloadTarget = { kind: 'url'; url: string } | { kind: 'file'; path: string };

export interface StoragePort {
  putPublic(key: string, body: Buffer, contentType: string): Promise<string>;
  /** Stores a protected file. Returns the storage key — protected files have no public URL. */
  putPrivate(key: string, body: Buffer, contentType: string): Promise<string>;
  /** Resolves a protected key for download. R2: 15-minute presigned GET. Local: disk path.
   * `downloadName` sets the attachment filename on R2; local ignores it (the route sets it). */
  resolveDownload(key: string, downloadName?: string): Promise<DownloadTarget>;
}

export const LOCAL_UPLOAD_DIR = join(process.cwd(), 'uploads');
// Public and private files live in DISJOINT subtrees; the /files static mount serves
// only public/ — no path trick can cross into private/ because it simply isn't under
// the served root.
export const LOCAL_PUBLIC_DIR = join(LOCAL_UPLOAD_DIR, 'public');
const SIGNED_URL_TTL_SECONDS = 15 * 60; // spec §3: 15-minute expiry

class LocalStorage implements StoragePort {
  async putPublic(key: string, body: Buffer): Promise<string> {
    await this.write(join(LOCAL_PUBLIC_DIR, key), body);
    return `/files/${key}`;
  }

  async putPrivate(key: string, body: Buffer): Promise<string> {
    await this.write(join(LOCAL_UPLOAD_DIR, key), body);
    return key;
  }

  async resolveDownload(key: string): Promise<DownloadTarget> {
    return { kind: 'file', path: join(LOCAL_UPLOAD_DIR, key) };
  }

  private async write(path: string, body: Buffer): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
}

class R2Storage implements StoragePort {
  // Private objects belong in a bucket with NO public domain — sharing the public bucket
  // makes every key permanently fetchable via R2_PUBLIC_BASE_URL.
  private privateBucket = env.R2_PRIVATE_BUCKET ?? env.R2_BUCKET;

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

  async putPrivate(key: string, body: Buffer, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.privateBucket, Key: key, Body: body, ContentType: contentType }),
    );
    return key;
  }

  async resolveDownload(key: string, downloadName?: string): Promise<DownloadTarget> {
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.privateBucket,
        Key: key,
        ...(downloadName
          ? {
              ResponseContentDisposition: `attachment; filename="${downloadName.replace(/[^a-zA-Z0-9._ -]/g, '_')}"`,
            }
          : {}),
      }),
      { expiresIn: SIGNED_URL_TTL_SECONDS },
    );
    return { kind: 'url', url };
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

/** Protected-file key: private/<scope>/<random>/<sanitized original name>. The original
 * name is kept (sanitized) so downloads can carry a human filename. Scope is sanitized
 * too — defense-in-depth against path traversal from future callers. */
export function makeAttachmentKey(scope: string, originalName: string): string {
  const safeScope = scope.replace(/[^a-zA-Z0-9_-]/g, '_') || 'files';
  const safe = originalName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.\.+/g, '_').slice(-80) || 'file';
  return `private/${safeScope}/${randomBytes(12).toString('hex')}/${safe}`;
}
