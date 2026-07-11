import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCAL_UPLOAD_DIR, makeAttachmentKey, storage } from '../src/services/storage.js';

describe('private storage (local driver)', () => {
  it('putPrivate writes under the private prefix and returns the key', async () => {
    const key = makeAttachmentKey('tasks', 'report.pdf');
    expect(key).toMatch(/^private\/tasks\/[a-f0-9]{24}\/report\.pdf$/);
    const returned = await storage.putPrivate(key, Buffer.from('%PDF-fake'), 'application/pdf');
    expect(returned).toBe(key);
    expect(readFileSync(join(LOCAL_UPLOAD_DIR, key)).toString()).toBe('%PDF-fake');
  });

  it('resolveDownload returns a local file path in dev', async () => {
    const key = makeAttachmentKey('tasks', 'notes.txt');
    await storage.putPrivate(key, Buffer.from('hello'), 'text/plain');
    const dl = await storage.resolveDownload(key);
    expect(dl.kind).toBe('file');
    if (dl.kind === 'file') expect(readFileSync(dl.path).toString()).toBe('hello');
  });

  it('sanitizes hostile filenames in keys', () => {
    const key = makeAttachmentKey('tasks', '../../evil <script>.pdf');
    expect(key).not.toContain('..');
    expect(key).toMatch(/^private\/tasks\/[a-f0-9]{24}\/[a-zA-Z0-9._-]+$/);
  });

  it('sanitizes hostile scopes in keys', () => {
    const key = makeAttachmentKey('../evil', 'a.pdf');
    expect(key).not.toContain('..');
    expect(key).toMatch(/^private\/[a-zA-Z0-9_-]+\/[a-f0-9]{24}\//);
    expect(key.split('/')).toHaveLength(4); // no separators beyond private/<scope>/<random>/<name>
  });
});
