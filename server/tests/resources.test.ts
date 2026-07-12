import { describe, expect, it } from 'vitest';
import { Resource, toPublicResource } from '../src/models/Resource.js';
import { Category } from '../src/models/Category.js';
import { User } from '../src/models/User.js';
import { fileTypeOf } from '../src/utils/fileType.js';

describe('fileTypeOf', () => {
  it('maps common content types and falls back by extension, then other', () => {
    expect(fileTypeOf('application/pdf', 'guide.pdf')).toBe('pdf');
    expect(fileTypeOf('image/png', 'logo.png')).toBe('image');
    expect(fileTypeOf('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'a.docx')).toBe('word');
    expect(fileTypeOf('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'a.xlsx')).toBe('excel');
    expect(fileTypeOf('application/vnd.openxmlformats-officedocument.presentationml.presentation', 'a.pptx')).toBe('powerpoint');
    expect(fileTypeOf('video/mp4', 'tour.mp4')).toBe('video');
    expect(fileTypeOf('application/octet-stream', 'archive.zip')).toBe('archive');
    expect(fileTypeOf('application/octet-stream', 'notes.txt')).toBe('text');
    expect(fileTypeOf('application/octet-stream', 'mystery.bin')).toBe('other');
    expect(fileTypeOf('application/octet-stream', 'Makefile')).toBe('other');
  });
});

describe('Resource model', () => {
  it('applies defaults; link resources carry no versions', async () => {
    const u = await User.create({ email: 'r@x.com', hashedPassword: 'x', role: 'broker', displayName: 'r' });
    const cat = await Category.create({ name: 'Marketing' });
    const r = await Resource.create({
      title: 'Brand portal',
      kind: 'link',
      externalUrl: 'https://brand.example.com',
      categoryId: cat.id,
      uploadedBy: u.id,
      fileType: 'link', // set explicitly: the model default is 'other'; the service layer (Task 3) is what maps kind:'link' -> fileType:'link'
    });
    expect(r.description).toBe('');
    expect(r.subcategoryId).toBeNull();
    expect(r.officeId).toBeNull();
    expect(r.featured).toBe(false);
    expect(r.versions).toHaveLength(0);
    expect(r.fileType).toBe('link');
  });

  it('file resources expose the LAST version as current via toPublicResource', async () => {
    const u = await User.create({ email: 'r2@x.com', hashedPassword: 'x', role: 'broker', displayName: 'r2' });
    const cat = await Category.create({ name: 'Forms' });
    const r = await Resource.create({
      title: 'W-9',
      kind: 'file',
      categoryId: cat.id,
      uploadedBy: u.id,
      fileType: 'pdf',
      versions: [
        { key: 'private/resources/a/v1.pdf', name: 'w9-2025.pdf', size: 100, contentType: 'application/pdf', uploadedBy: u.id },
        { key: 'private/resources/a/v2.pdf', name: 'w9-2026.pdf', size: 120, contentType: 'application/pdf', uploadedBy: u.id },
      ],
    });
    const pub = toPublicResource(r, false);
    expect(pub.currentFile).toEqual({ name: 'w9-2026.pdf', size: 120, contentType: 'application/pdf' });
    expect('versions' in pub).toBe(false); // agents never see history
    const admin = toPublicResource(r, true);
    expect(admin.versions).toHaveLength(2); // admins see the full history (no keys)
    for (const v of admin.versions as { key?: string }[]) expect(v.key).toBeUndefined();
  });
});
