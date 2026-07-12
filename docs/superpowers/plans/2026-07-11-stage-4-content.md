# Stage 4 — Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the content layer: the Resource Hub (two-level categories, file/link resources with version history, office targeting, keyword search + filters, featured tiles, bookmarks with a My Resources view, signed-URL downloads with engagement logging, bookmark-category notifications) and Banner Ads (image or rich-text banners with CTAs, scheduling, office targeting, a rotating homepage slot, and click tracking with admin-visible counts).

**Architecture:** Everything reuses Stage 1–3 machinery. Resource files are **protected files** on the existing private-storage surface (`putPrivate`/`resolveDownload` → 15-minute presigned R2 GET or streamed local file, always `attachment` disposition); banner images are **public** uploads like post images. Versioning is an append-only array on the resource — the last element is current, agents only ever see it, admins can list and download prior versions. The homepage banner slot ships now (Stage 5 only rearranges it). Engagement events `download` and `bannerClick` (enum values from Stage 1) start flowing here.

**Tech Stack:** No new dependencies. Express 4, Mongoose 8, Zod 3, existing multer/storage/sanitizer/notify/emitActivity utilities, React 18 + TanStack Query 5, existing UI primitives.

**Conventions for every task:**
- Run all commands from the repo root (`C:\Users\derri\OneDrive\Desktop\openagent`). Bash syntax.
- Server relative imports MUST use `.js` extensions (ESM + NodeNext) even in `.ts` source.
- Work on branch `feat/stage-4-content` (created in Task 1). Commit after each green task. Never commit `.env`. Never push — the controller pushes.
- Server tests: `npm -w server run test`. Client: `npm -w client run test`. In-memory-Mongo setup exists; Agenda never starts in tests.
- Match established patterns exactly: `toPublicX` mappers, `visibilityFilter(req)`/`loadVisibleX` helpers with 404-for-invisible, role gates mirrored client/server, `role="alert"` + isAxiosError error surfacing, 44px targets + aria-labels, query keys invalidated by exact prefix, sanitized rich text rendered only via the commented `dangerouslySetInnerHTML` pattern.
- Baseline at branch time: server 172 tests, client 60. Each task states expected totals.

**Stage-4 scope decisions (locked — do not relitigate during implementation):**
- Resource files accept **any file type** (PRD 5.6) up to 50MB. The safety model is NOT an allowlist: files live in private storage, downloads always force `attachment` disposition (both drivers), and nothing is ever served inline or from the public bucket. This is why the Stage 3 attachment allowlist does not apply here.
- Resource `description` is **plain text** (≤2000 chars) — the PRD does not call for rich text, and plain text feeds search directly. `descriptionHtml` machinery is deliberately not used.
- The PRD is self-contradictory on the bookmark notification (5.6.2 bookmarks are per-resource; 5.9.2 says "category user has bookmarked"). **Interpretation locked:** creating a resource in category X notifies users who have bookmarked at least one resource whose `categoryId` is X (creator excluded), type `bookmarkedResource`, email per prefs. Documented in code.
- Category deletion is **guarded**: a category with child categories or resources in it (as `categoryId` OR `subcategoryId`) refuses deletion with 400. No cascade, no orphaning.
- Banner "duplicate" copies every field (title suffixed " (copy)", `clickCount` reset to 0, same dates) — the admin edits dates afterward. PRD's "duplicated and rescheduled" is two steps.
- Banner rotation: the slot shows up to 3 banners at once; when more than 3 are active, the visible window advances by one banner every 5 seconds (wrapping). ≤3 active → static, no timer.
- Version history is visible to **officeAdmin+** (a deliberate softening of PRD 5.6's "accessible to Broker/Owner": office admins upload replacement versions, so they need to see the history they create; featured stays broker-only exactly as written). Versions are indefinitely retained; old version files are never deleted from storage.

**API surface added (all under `/api/v1`):**

| Method & path | Who | Purpose |
|---|---|---|
| `GET /categories` | any user | two-level tree for pickers/filters |
| `POST /categories` · `PATCH /:id` · `DELETE /:id` | officeAdmin+ | manage structure (delete guarded) |
| `GET /resources?q&categoryId&fileType&scope&page` | any user (visibility-scoped) | hub list; `scope=mine` = bookmarked |
| `GET /resources/featured` | any user | ≤6 featured tiles (visibility-scoped) |
| `GET /resources/:id` | any user (scoped) | detail (+`versions` for officeAdmin+) |
| `POST /resources` · `PATCH /:id` · `DELETE /:id` | officeAdmin+ | CRUD (create = metadata; file attached via upload) |
| `POST /resources/:id/file` | officeAdmin+ | upload initial file / replace = new version |
| `POST /resources/:id/featured` · `DELETE /:id/featured` | broker | feature (max 6) / unfeature |
| `GET /resources/:id/download?version=` | any user (scoped; `version` officeAdmin+) | logs `download`, 302/streams |
| `POST /resources/:id/bookmark` · `DELETE /:id/bookmark` | any user (scoped) | bookmark toggle |
| `GET /banners/active` | any user (office-scoped) | live banners for the homepage slot |
| `POST /banners/:id/click` | any user | logs `bannerClick`, bumps count |
| `GET /banners` · `POST` · `PATCH /:id` · `DELETE /:id` · `POST /:id/duplicate` | officeAdmin+ | admin management (incl. expired, click counts) |
| `POST /uploads/banner-image` | officeAdmin+ | public banner image (≤5MB) |

---

### Task 1: Branch, Category model + routes

**Files:**
- Create: `server/src/models/Category.ts`
- Create: `server/src/validators/categories.ts`
- Create: `server/src/routes/categories.ts`
- Modify: `server/src/app.ts` (mount)
- Test: `server/tests/categories.test.ts`

Two-level structure as one collection: top-level categories have `parentId: null`; subcategories point at a top-level parent. Depth is enforced at write time (a parent must itself be parentless). Deletion is refused while children or resources reference the category — the Resource model doesn't exist yet, so the resource guard is written against the collection name and activates naturally in Task 2 (no forward import; documented in code).

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git pull
git checkout -b feat/stage-4-content
```

- [ ] **Step 2: Write the failing tests** — create `server/tests/categories.test.ts`:

```ts
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { Category } from '../src/models/Category.js';
import { User } from '../src/models/User.js';
import { hashPassword } from '../src/utils/password.js';

async function loginAs(app: ReturnType<typeof createApp>, email: string, role: string) {
  await User.create({ email, hashedPassword: await hashPassword('Password1!'), role, displayName: email });
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email, password: 'Password1!' });
  return agent;
}

describe('categories', () => {
  it('admin creates a two-level tree; agents read it; agents cannot write', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'c1@x.com', 'officeAdmin');
    const agent = await loginAs(app, 'c2@x.com', 'agent');

    const top = await admin.post('/api/v1/categories').send({ name: 'Marketing' });
    expect(top.status).toBe(201);
    const sub = await admin.post('/api/v1/categories').send({ name: 'Templates', parentId: top.body.category.id });
    expect(sub.status).toBe(201);

    const tree = await agent.get('/api/v1/categories');
    expect(tree.status).toBe(200);
    expect(tree.body.categories).toHaveLength(2);
    const names = tree.body.categories.map((c: { name: string }) => c.name).sort();
    expect(names).toEqual(['Marketing', 'Templates']);

    expect((await agent.post('/api/v1/categories').send({ name: 'Nope' })).status).toBe(403);
  });

  it('enforces two-level depth: a subcategory cannot be a parent', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'c3@x.com', 'broker');
    const top = (await admin.post('/api/v1/categories').send({ name: 'Compliance' })).body.category;
    const sub = (await admin.post('/api/v1/categories').send({ name: 'Forms', parentId: top.id })).body.category;
    const res = await admin.post('/api/v1/categories').send({ name: 'Too deep', parentId: sub.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/two levels/i);
  });

  it('rename works; deletion is refused while children exist, allowed after', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'c4@x.com', 'broker');
    const top = (await admin.post('/api/v1/categories').send({ name: 'Training' })).body.category;
    const sub = (await admin.post('/api/v1/categories').send({ name: 'Scripts', parentId: top.id })).body.category;

    const renamed = await admin.patch(`/api/v1/categories/${top.id}`).send({ name: 'Training & Dev' });
    expect(renamed.body.category.name).toBe('Training & Dev');

    expect((await admin.delete(`/api/v1/categories/${top.id}`)).status).toBe(400); // has a child
    expect((await admin.delete(`/api/v1/categories/${sub.id}`)).status).toBe(200);
    expect((await admin.delete(`/api/v1/categories/${top.id}`)).status).toBe(200); // now empty
    expect(await Category.countDocuments()).toBe(0);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm -w server run test -- tests/categories.test.ts`
Expected: FAIL — cannot resolve the Category model.

- [ ] **Step 4: Write `server/src/models/Category.ts`**

```ts
import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    // null = top-level category; set = subcategory of a TOP-LEVEL parent (depth 2 max,
    // enforced in the route — the schema cannot see the parent's own parentId).
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
  },
  { timestamps: true },
);
categorySchema.index({ parentId: 1, name: 1 });

export const Category = mongoose.model('Category', categorySchema);
export type CategoryDoc = InstanceType<typeof Category>;

export function toPublicCategory(c: CategoryDoc) {
  return {
    id: c.id as string,
    name: c.name,
    parentId: c.parentId ? String(c.parentId) : null,
  };
}
```

- [ ] **Step 5: Write `server/src/validators/categories.ts`**

```ts
import { z } from 'zod';

export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  parentId: z.string().nullable().optional(),
});

export const updateCategorySchema = z.object({
  name: z.string().trim().min(1).max(80),
});
```

- [ ] **Step 6: Write `server/src/routes/categories.ts`**

```ts
import { Router } from 'express';
import mongoose from 'mongoose';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { Category, toPublicCategory } from '../models/Category.js';
import { createCategorySchema, updateCategorySchema } from '../validators/categories.js';

export const categoriesRouter = Router();
categoriesRouter.use(requireAuth);

categoriesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const categories = await Category.find().sort({ parentId: 1, name: 1 });
    res.json({ categories: categories.map(toPublicCategory) });
  }),
);

categoriesRouter.post(
  '/',
  requireRole('officeAdmin'),
  validate(createCategorySchema),
  asyncHandler(async (req, res) => {
    if (req.body.parentId) {
      const parent = await Category.findById(req.body.parentId);
      if (!parent) throw new AppError(400, 'Unknown parent category');
      if (parent.parentId) throw new AppError(400, 'Categories go at most two levels deep');
    }
    const category = await Category.create({ name: req.body.name, parentId: req.body.parentId ?? null });
    res.status(201).json({ category: toPublicCategory(category) });
  }),
);

categoriesRouter.patch(
  '/:id',
  requireRole('officeAdmin'),
  validate(updateCategorySchema),
  asyncHandler(async (req, res) => {
    const category = await Category.findByIdAndUpdate(req.params.id, { $set: { name: req.body.name } }, { new: true });
    if (!category) throw new AppError(404, 'Category not found');
    res.json({ category: toPublicCategory(category) });
  }),
);

categoriesRouter.delete(
  '/:id',
  requireRole('officeAdmin'),
  asyncHandler(async (req, res) => {
    const category = await Category.findById(req.params.id);
    if (!category) throw new AppError(404, 'Category not found');
    const childCount = await Category.countDocuments({ parentId: category.id });
    if (childCount > 0) throw new AppError(400, 'Delete or move its subcategories first');
    // Guard against resources referencing this category. The Resource model lands in the
    // next task; querying the raw collection keeps this file import-cycle-free and makes
    // the guard activate automatically once resources exist.
    const resourceCount = await mongoose.connection.db!
      .collection('resources')
      .countDocuments({ $or: [{ categoryId: category._id }, { subcategoryId: category._id }] });
    if (resourceCount > 0) throw new AppError(400, 'Move or delete the resources in this category first');
    await category.deleteOne();
    res.json({ ok: true });
  }),
);
```

- [ ] **Step 7: Mount in `server/src/app.ts`**

```ts
import { categoriesRouter } from './routes/categories.js';
```
```ts
app.use('/api/v1/categories', categoriesRouter);
```

- [ ] **Step 8: Run the full server suite**

Run: `npm -w server run test`
Expected: PASS — 175 tests (172 + 3). Then `npm -w server run typecheck` + `npm run lint`.

- [ ] **Step 9: Commit**

```bash
git add server/src/models/Category.ts server/src/validators/categories.ts server/src/routes/categories.ts server/src/app.ts server/tests/categories.test.ts docs/superpowers/plans/2026-07-11-stage-4-content.md
git commit -m "feat(server): two-level resource categories with guarded deletion"
```

(The plan file rides along in this first commit so the branch is self-documenting, same as Stages 2–3.)

---

### Task 2: Resource model + fileType utility

**Files:**
- Create: `server/src/utils/fileType.ts`
- Create: `server/src/models/Resource.ts`
- Test: `server/tests/resources.test.ts` (started here)

The resource is either a `file` (version array; last element is current) or a `link` (external https URL). `fileType` is a derived, filterable label. Featured is a boolean capped at 6 by the service (Task 3), mirroring the pinned-posts pattern.

- [ ] **Step 1: Write the failing tests** — create `server/tests/resources.test.ts`:

```ts
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
    });
    expect(r.description).toBe('');
    expect(r.subcategoryId).toBeNull();
    expect(r.officeId).toBeNull();
    expect(r.featured).toBe(false);
    expect(r.versions).toHaveLength(0);
    expect(r.fileType).toBe('link');
  });

  it('file resources expose the LAST version as current via toPublicResource', async () => {
    // toPublicResource is imported at the top alongside Resource.
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
    expect((admin.versions as { key?: string }[])[0].key).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure** (modules missing).

- [ ] **Step 3: Write `server/src/utils/fileType.ts`**

```ts
export const FILE_TYPES = ['pdf', 'image', 'word', 'excel', 'powerpoint', 'video', 'audio', 'archive', 'text', 'other', 'link'] as const;
export type FileType = (typeof FILE_TYPES)[number];

const BY_CONTENT_TYPE: [RegExp, FileType][] = [
  [/^application\/pdf$/, 'pdf'],
  [/^image\//, 'image'],
  [/wordprocessingml|msword/, 'word'],
  [/spreadsheetml|ms-excel/, 'excel'],
  [/presentationml|ms-powerpoint/, 'powerpoint'],
  [/^video\//, 'video'],
  [/^audio\//, 'audio'],
  [/zip|x-tar|x-7z|x-rar/, 'archive'],
  [/^text\//, 'text'],
];

const BY_EXTENSION: Record<string, FileType> = {
  pdf: 'pdf', png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image',
  doc: 'word', docx: 'word', xls: 'excel', xlsx: 'excel', csv: 'excel',
  ppt: 'powerpoint', pptx: 'powerpoint', mp4: 'video', mov: 'video',
  mp3: 'audio', wav: 'audio', zip: 'archive', rar: 'archive', '7z': 'archive',
  txt: 'text', md: 'text',
};

/** Filterable label for a stored file: content type first, extension fallback, then 'other'. */
export function fileTypeOf(contentType: string, fileName: string): FileType {
  for (const [re, type] of BY_CONTENT_TYPE) if (re.test(contentType)) return type;
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return BY_EXTENSION[ext] ?? 'other';
}
```

- [ ] **Step 4: Write `server/src/models/Resource.ts`**

```ts
import mongoose from 'mongoose';
import { FILE_TYPES } from '../utils/fileType.js';

const versionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    name: { type: String, required: true, maxlength: 120 },
    size: { type: Number, required: true },
    contentType: { type: String, required: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    uploadedAt: { type: Date, default: () => new Date() },
  },
  { _id: false },
);

const resourceSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    // Plain text by locked scope decision — feeds $text search directly.
    description: { type: String, default: '', maxlength: 2000 },
    kind: { type: String, enum: ['file', 'link'], required: true },
    externalUrl: { type: String, default: '' },
    // Append-only; the LAST element is the current version (PRD 5.6: prior versions
    // archived indefinitely, admin-visible only).
    versions: { type: [versionSchema], default: [] },
    fileType: { type: String, enum: FILE_TYPES, default: 'other' },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    subcategoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    officeId: { type: mongoose.Schema.Types.ObjectId, default: null },
    featured: { type: Boolean, default: false },
  },
  { timestamps: true },
);
resourceSchema.index({ title: 'text', description: 'text' });
resourceSchema.index({ categoryId: 1, subcategoryId: 1 });
resourceSchema.index({ featured: 1 });

export const Resource = mongoose.model('Resource', resourceSchema);
export type ResourceDoc = InstanceType<typeof Resource>;

/** includeVersions = officeAdmin+ only. Storage keys never leave the server. */
export function toPublicResource(r: ResourceDoc, includeVersions: boolean) {
  const current = r.versions.length > 0 ? r.versions[r.versions.length - 1] : null;
  return {
    id: r.id as string,
    title: r.title,
    description: r.description,
    kind: r.kind,
    externalUrl: r.externalUrl,
    fileType: r.fileType,
    categoryId: String(r.categoryId),
    subcategoryId: r.subcategoryId ? String(r.subcategoryId) : null,
    uploadedBy: String(r.uploadedBy),
    officeId: r.officeId,
    featured: r.featured,
    currentFile: current ? { name: current.name, size: current.size, contentType: current.contentType } : null,
    createdAt: r.get('createdAt') as Date,
    updatedAt: r.get('updatedAt') as Date,
    ...(includeVersions
      ? {
          versions: r.versions.map((v) => ({
            name: v.name,
            size: v.size,
            contentType: v.contentType,
            uploadedBy: String(v.uploadedBy),
            uploadedAt: v.uploadedAt,
          })),
        }
      : {}),
  };
}
```

- [ ] **Step 5: Run the full server suite**

Run: `npm -w server run test`
Expected: PASS — 178 tests (175 + 3). Typecheck + lint clean.

- [ ] **Step 6: Commit**

```bash
git add server/src/utils/fileType.ts server/src/models/Resource.ts server/tests/resources.test.ts
git commit -m "feat(server): resource model with version history and file-type labels"
```

### Task 3: Enums, Bookmark model, resource service

**Files:**
- Modify: `server/src/models/Notification.ts` (append enum value)
- Modify: `server/src/models/ActivityEvent.ts` (append enum value)
- Create: `server/src/models/Bookmark.ts`
- Create: `server/src/services/resourceService.ts`
- Test: `server/tests/resourceService.test.ts`

The service owns creation/update/deletion, the featured cap (max 6, mirroring the pinned-posts pattern), and the **bookmark-category notification** (locked interpretation: users who bookmarked ≥1 resource in the new resource's category, creator excluded). Because file resources are created in two steps (metadata POST, then file upload), the notification + activity fire at **create time for links** but at **first-file-upload time for files** — `announceResource` is exported so the upload route (Task 5) calls it too.

- [ ] **Step 1: Extend the enums.** In `server/src/models/Notification.ts` the enum comment already reserves this — append to `NOTIFICATION_TYPES`:

```ts
  'bookmarkedResource',
```

In `server/src/models/ActivityEvent.ts` append to `ACTIVITY_TYPES`:

```ts
  'resourceUploaded',
```

Update each file's leading "Stage 4 appends…" comment to say the value is now present.

- [ ] **Step 2: Write `server/src/models/Bookmark.ts`**

```ts
import mongoose from 'mongoose';

const bookmarkSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    resourceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Resource', required: true },
  },
  { timestamps: true },
);
bookmarkSchema.index({ userId: 1, resourceId: 1 }, { unique: true });

export const Bookmark = mongoose.model('Bookmark', bookmarkSchema);
```

- [ ] **Step 3: Write the failing tests** — create `server/tests/resourceService.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Bookmark } from '../src/models/Bookmark.js';
import { Category } from '../src/models/Category.js';
import { Notification } from '../src/models/Notification.js';
import { Resource } from '../src/models/Resource.js';
import { User } from '../src/models/User.js';
import { announceResource, createResource, deleteResource, setFeatured, updateResource } from '../src/services/resourceService.js';

async function makeUser(email: string, role = 'agent') {
  return User.create({ email, hashedPassword: 'x', role, displayName: email });
}

describe('resourceService', () => {
  it('link resources announce at create; bookmarkers of the category are notified, creator excluded', async () => {
    const broker = await makeUser('rs1@x.com', 'broker');
    const fan = await makeUser('rs2@x.com');
    const stranger = await makeUser('rs3@x.com');
    const cat = await Category.create({ name: 'Marketing' });
    const otherCat = await Category.create({ name: 'Compliance' });

    // fan bookmarked an EXISTING resource in Marketing; stranger bookmarked one in Compliance.
    const seed = await createResource({ title: 'Old kit', kind: 'link', externalUrl: 'https://a.example.com', categoryId: cat.id }, broker);
    const seedOther = await createResource({ title: 'Old form', kind: 'link', externalUrl: 'https://b.example.com', categoryId: otherCat.id }, broker);
    await Bookmark.create({ userId: fan.id, resourceId: seed.id });
    await Bookmark.create({ userId: stranger.id, resourceId: seedOther.id });
    await Notification.deleteMany({}); // ignore anything from seeding

    await createResource({ title: 'New kit', kind: 'link', externalUrl: 'https://c.example.com', categoryId: cat.id }, broker);
    const notes = await Notification.find({ type: 'bookmarkedResource' });
    expect(notes).toHaveLength(1);
    expect(String(notes[0].userId)).toBe(fan.id);
    expect(notes[0].title).toContain('New kit');
  });

  it('file resources do NOT announce at create (no file yet); announceResource with no followers is a no-op', async () => {
    const broker = await makeUser('rs4@x.com', 'broker');
    const cat = await Category.create({ name: 'Forms' });
    const r = await createResource({ title: 'W-9', kind: 'file', categoryId: cat.id }, broker);
    expect(await Notification.countDocuments({ type: 'bookmarkedResource' })).toBe(0);
    await announceResource(r, broker.id); // what the upload route calls on FIRST version
    // no bookmarkers in this category → still zero notifications, but no crash
    expect(await Notification.countDocuments({ type: 'bookmarkedResource' })).toBe(0);
  });

  it('rejects a subcategory that is not a child of the chosen category', async () => {
    const broker = await makeUser('rs5@x.com', 'broker');
    const a = await Category.create({ name: 'A' });
    const b = await Category.create({ name: 'B' });
    const subOfB = await Category.create({ name: 'B1', parentId: b.id });
    await expect(
      createResource({ title: 'Bad', kind: 'link', externalUrl: 'https://x.example.com', categoryId: a.id, subcategoryId: subOfB.id }, broker),
    ).rejects.toThrow(/subcategory/i);
  });

  it('caps featured at 6', async () => {
    const broker = await makeUser('rs6@x.com', 'broker');
    const cat = await Category.create({ name: 'C' });
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await createResource({ title: `R${i}`, kind: 'link', externalUrl: 'https://x.example.com', categoryId: cat.id }, broker);
      ids.push(r.id);
    }
    for (let i = 0; i < 6; i++) await setFeatured(ids[i], true);
    await expect(setFeatured(ids[6], true)).rejects.toThrow(/6/);
    await setFeatured(ids[0], false);
    await expect(setFeatured(ids[6], true)).resolves.toBeDefined();
  });

  it('update revalidates the category pair; delete removes the resource and its bookmarks', async () => {
    const broker = await makeUser('rs7@x.com', 'broker');
    const fan = await makeUser('rs8@x.com');
    const cat = await Category.create({ name: 'D' });
    const sub = await Category.create({ name: 'D1', parentId: cat.id });
    const r = await createResource({ title: 'Doc', kind: 'link', externalUrl: 'https://x.example.com', categoryId: cat.id }, broker);
    const updated = await updateResource(r.id, { subcategoryId: sub.id });
    expect(String(updated.subcategoryId)).toBe(sub.id);

    await Bookmark.create({ userId: fan.id, resourceId: r.id });
    await deleteResource(r.id);
    expect(await Resource.countDocuments()).toBe(0);
    expect(await Bookmark.countDocuments()).toBe(0);
  });
});
```

- [ ] **Step 4: Run to verify failure** (`npm -w server run test -- tests/resourceService.test.ts`).

- [ ] **Step 5: Write `server/src/services/resourceService.ts`**

```ts
import { AppError } from '../middleware/errorHandler.js';
import { Bookmark } from '../models/Bookmark.js';
import { Category } from '../models/Category.js';
import { Resource, type ResourceDoc } from '../models/Resource.js';
import type { UserDoc } from '../models/User.js';
import { emitActivity } from './activityService.js';
import { notify } from './notificationService.js';

export interface ResourceInput {
  title: string;
  description?: string;
  kind: 'file' | 'link';
  externalUrl?: string;
  categoryId: string;
  subcategoryId?: string | null;
  officeId?: string | null;
}

/** Category must exist and be top-level; subcategory (if any) must be its child. */
async function assertCategoryPair(categoryId: string, subcategoryId?: string | null): Promise<void> {
  const category = await Category.findById(categoryId);
  if (!category || category.parentId) throw new AppError(400, 'Pick a top-level category');
  if (subcategoryId) {
    const sub = await Category.findById(subcategoryId);
    if (!sub || String(sub.parentId) !== categoryId) {
      throw new AppError(400, 'That subcategory does not belong to the chosen category');
    }
  }
}

/** Notification (PRD 5.9.2, locked interpretation: users who bookmarked any resource in
 * this category) + feed entry. Called at create for links, at FIRST file upload for files
 * — a file resource with no file yet is invisible to agents, so announcing it would 404. */
export async function announceResource(resource: ResourceDoc, actorId: string): Promise<void> {
  const categoryPeers = await Resource.find({ categoryId: resource.categoryId, _id: { $ne: resource.id } }).distinct('_id');
  const userIds = (await Bookmark.distinct('userId', { resourceId: { $in: categoryPeers } }))
    .map(String)
    .filter((id) => id !== actorId);
  const category = await Category.findById(resource.categoryId);
  await notify(
    userIds,
    { type: 'bookmarkedResource', title: `New resource in ${category?.name ?? 'a category you follow'}: ${resource.title}`, link: `/resources/${resource.id}` },
    {
      subject: `New resource: ${resource.title}`,
      html: `<p>A new resource was added to <strong>${category?.name ?? 'a category you follow'}</strong>: ${resource.title}.</p><p>Open the Resource Hub to view it.</p>`,
    },
  );
  await emitActivity({
    type: 'resourceUploaded',
    message: `New resource: ${resource.title}`,
    link: `/resources/${resource.id}`,
    officeId: resource.officeId ? String(resource.officeId) : null,
    actorId,
  });
}

export async function createResource(input: ResourceInput, creator: UserDoc): Promise<ResourceDoc> {
  await assertCategoryPair(input.categoryId, input.subcategoryId);
  if (input.kind === 'link' && !input.externalUrl) throw new AppError(400, 'Link resources need a URL');
  const resource = await Resource.create({
    title: input.title,
    description: input.description ?? '',
    kind: input.kind,
    externalUrl: input.kind === 'link' ? input.externalUrl : '',
    fileType: input.kind === 'link' ? 'link' : 'other',
    categoryId: input.categoryId,
    subcategoryId: input.subcategoryId ?? null,
    uploadedBy: creator.id,
    officeId: input.officeId ?? null,
  });
  if (resource.kind === 'link') await announceResource(resource, creator.id);
  return resource;
}

export async function updateResource(id: string, patch: Partial<ResourceInput>): Promise<ResourceDoc> {
  const resource = await Resource.findById(id);
  if (!resource) throw new AppError(404, 'Resource not found');
  const categoryId = patch.categoryId ?? String(resource.categoryId);
  const subcategoryId = patch.subcategoryId !== undefined ? patch.subcategoryId : resource.subcategoryId ? String(resource.subcategoryId) : null;
  await assertCategoryPair(categoryId, subcategoryId);
  if (patch.title !== undefined) resource.title = patch.title;
  if (patch.description !== undefined) resource.description = patch.description;
  if (patch.externalUrl !== undefined && resource.kind === 'link') resource.externalUrl = patch.externalUrl;
  resource.categoryId = categoryId as never;
  resource.subcategoryId = subcategoryId as never;
  if (patch.officeId !== undefined) resource.officeId = (patch.officeId ?? null) as never;
  await resource.save();
  return resource;
}

/** PRD 5.6: at most 6 featured at any time. Same read-then-write shape as post pinning —
 * fine for a single-instance app. */
export async function setFeatured(id: string, featured: boolean): Promise<ResourceDoc> {
  const resource = await Resource.findById(id);
  if (!resource) throw new AppError(404, 'Resource not found');
  if (featured && !resource.featured) {
    const count = await Resource.countDocuments({ featured: true });
    if (count >= 6) throw new AppError(400, 'Up to 6 resources can be featured — unfeature one first');
  }
  resource.featured = featured;
  await resource.save();
  return resource;
}

/** Bookmarks go with the resource. Stored version files are retained (PRD: indefinitely). */
export async function deleteResource(id: string): Promise<void> {
  const resource = await Resource.findById(id);
  if (!resource) throw new AppError(404, 'Resource not found');
  await Bookmark.deleteMany({ resourceId: resource.id });
  await resource.deleteOne();
}
```

- [ ] **Step 6: Run the full server suite**

Run: `npm -w server run test`
Expected: PASS — 183 tests (178 + 5). Typecheck + lint clean.

- [ ] **Step 7: Commit**

```bash
git add server/src/models/Notification.ts server/src/models/ActivityEvent.ts server/src/models/Bookmark.ts server/src/services/resourceService.ts server/tests/resourceService.test.ts
git commit -m "feat(server): resource service with featured cap and bookmark-category notifications"
```

---

### Task 4: Resource routes — list/search, featured, detail, CRUD, bookmarks

**Files:**
- Create: `server/src/validators/resources.ts`
- Create: `server/src/routes/resources.ts`
- Modify: `server/src/app.ts` (mount)
- Test: `server/tests/resourceRoutes.test.ts`

Visibility mirrors posts: agents see all-users or own-office; admins see everything. Agents additionally never see file resources that have no uploaded file yet (the metadata-created-but-not-uploaded window). Filtering by a top-level category includes its subcategories' resources. Every list/detail response tells the viewer whether they bookmarked each resource.

- [ ] **Step 1: Write the failing tests** — create `server/tests/resourceRoutes.test.ts`:

```ts
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { Resource } from '../src/models/Resource.js';
import { User } from '../src/models/User.js';
import { hashPassword } from '../src/utils/password.js';

async function loginAs(app: ReturnType<typeof createApp>, email: string, role: string, officeId: string | null = null) {
  await User.create({ email, hashedPassword: await hashPassword('Password1!'), role, displayName: email, officeId });
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email, password: 'Password1!' });
  return agent;
}

describe('resource routes', () => {
  it('office targeting: agents see all-users + own office; admins see everything; fileless file-resources hidden from agents', async () => {
    const app = createApp();
    const officeA = '64b000000000000000000001';
    const admin = await loginAs(app, 'rr1@x.com', 'officeAdmin');
    const agentA = await loginAs(app, 'rr2@x.com', 'agent', officeA);
    const cat = (await admin.post('/api/v1/categories').send({ name: 'Marketing' })).body.category;

    await admin.post('/api/v1/resources').send({ title: 'Everyone', kind: 'link', externalUrl: 'https://a.example.com', categoryId: cat.id });
    await admin.post('/api/v1/resources').send({ title: 'Office A only', kind: 'link', externalUrl: 'https://b.example.com', categoryId: cat.id, officeId: officeA });
    await admin.post('/api/v1/resources').send({ title: 'Other office', kind: 'link', externalUrl: 'https://c.example.com', categoryId: cat.id, officeId: '64b000000000000000000002' });
    await admin.post('/api/v1/resources').send({ title: 'Pending file', kind: 'file', categoryId: cat.id }); // no file yet

    const forAgent = await agentA.get('/api/v1/resources');
    expect(forAgent.body.resources.map((r: { title: string }) => r.title).sort()).toEqual(['Everyone', 'Office A only']);
    const forAdmin = await admin.get('/api/v1/resources');
    expect(forAdmin.body.total).toBe(4);
    // detail parity: invisible = 404
    const hidden = (await Resource.findOne({ title: 'Other office' }))!.id;
    expect((await agentA.get(`/api/v1/resources/${hidden}`)).status).toBe(404);
  });

  it('search + filters: q matches title/description, categoryId includes subcategories, fileType filters', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'rr3@x.com', 'broker');
    const cat = (await admin.post('/api/v1/categories').send({ name: 'Training' })).body.category;
    const sub = (await admin.post('/api/v1/categories').send({ name: 'Scripts', parentId: cat.id })).body.category;
    await admin.post('/api/v1/resources').send({ title: 'Cold call script', description: 'openers and objections', kind: 'link', externalUrl: 'https://a.example.com', categoryId: cat.id, subcategoryId: sub.id });
    await admin.post('/api/v1/resources').send({ title: 'Brand book', kind: 'link', externalUrl: 'https://b.example.com', categoryId: cat.id });

    expect((await admin.get('/api/v1/resources?q=objections')).body.resources).toHaveLength(1);
    expect((await admin.get(`/api/v1/resources?categoryId=${cat.id}`)).body.resources).toHaveLength(2); // parent includes child
    expect((await admin.get(`/api/v1/resources?categoryId=${sub.id}`)).body.resources).toHaveLength(1);
    expect((await admin.get('/api/v1/resources?fileType=link')).body.resources).toHaveLength(2);
    expect((await admin.get('/api/v1/resources?fileType=pdf')).body.resources).toHaveLength(0);
  });

  it('bookmark round-trip: toggle, bookmarked flag in lists, scope=mine', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'rr4@x.com', 'broker');
    const agent = await loginAs(app, 'rr5@x.com', 'agent');
    const cat = (await admin.post('/api/v1/categories').send({ name: 'Forms' })).body.category;
    const r = (await admin.post('/api/v1/resources').send({ title: 'W-9', kind: 'link', externalUrl: 'https://a.example.com', categoryId: cat.id })).body.resource;

    expect((await agent.post(`/api/v1/resources/${r.id}/bookmark`)).status).toBe(200);
    expect((await agent.post(`/api/v1/resources/${r.id}/bookmark`)).status).toBe(200); // idempotent
    const list = await agent.get('/api/v1/resources');
    expect(list.body.resources[0].bookmarked).toBe(true);
    expect((await agent.get('/api/v1/resources?scope=mine')).body.resources).toHaveLength(1);
    await agent.delete(`/api/v1/resources/${r.id}/bookmark`);
    expect((await agent.get('/api/v1/resources?scope=mine')).body.resources).toHaveLength(0);
  });

  it('featured: broker-only toggle, featured endpoint respects visibility, agents cannot write resources', async () => {
    const app = createApp();
    const broker = await loginAs(app, 'rr6@x.com', 'broker');
    const officeAdmin = await loginAs(app, 'rr7@x.com', 'officeAdmin');
    const agent = await loginAs(app, 'rr8@x.com', 'agent');
    const cat = (await broker.post('/api/v1/categories').send({ name: 'Hot' })).body.category;
    const r = (await broker.post('/api/v1/resources').send({ title: 'Playbook', kind: 'link', externalUrl: 'https://a.example.com', categoryId: cat.id })).body.resource;

    expect((await officeAdmin.post(`/api/v1/resources/${r.id}/featured`)).status).toBe(403); // PRD: Broker/Owner marks featured
    expect((await broker.post(`/api/v1/resources/${r.id}/featured`)).status).toBe(200);
    expect((await agent.get('/api/v1/resources/featured')).body.resources.map((x: { title: string }) => x.title)).toEqual(['Playbook']);
    expect((await broker.delete(`/api/v1/resources/${r.id}/featured`)).status).toBe(200);
    expect((await agent.get('/api/v1/resources/featured')).body.resources).toHaveLength(0);
    expect((await agent.post('/api/v1/resources').send({ title: 'Nope', kind: 'link', externalUrl: 'https://x.example.com', categoryId: cat.id })).status).toBe(403);
  });

  it('detail includes versions for admins only; PATCH and DELETE work', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'rr9@x.com', 'officeAdmin');
    const agent = await loginAs(app, 'rr10@x.com', 'agent');
    const cat = (await admin.post('/api/v1/categories').send({ name: 'Docs' })).body.category;
    const r = (await admin.post('/api/v1/resources').send({ title: 'Guide', kind: 'link', externalUrl: 'https://a.example.com', categoryId: cat.id })).body.resource;

    expect('versions' in (await admin.get(`/api/v1/resources/${r.id}`)).body.resource).toBe(true);
    expect('versions' in (await agent.get(`/api/v1/resources/${r.id}`)).body.resource).toBe(false);
    const patched = await admin.patch(`/api/v1/resources/${r.id}`).send({ title: 'Guide v2' });
    expect(patched.body.resource.title).toBe('Guide v2');
    expect((await admin.delete(`/api/v1/resources/${r.id}`)).status).toBe(200);
    expect((await admin.get(`/api/v1/resources/${r.id}`)).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify failure** (routes missing → 404s).

- [ ] **Step 3: Write `server/src/validators/resources.ts`**

```ts
import { z } from 'zod';

const webUrl = z.string().url().refine((u) => u.startsWith('https://') || u.startsWith('http://'), 'Must be a web URL');

export const createResourceSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  kind: z.enum(['file', 'link']),
  externalUrl: webUrl.optional(),
  categoryId: z.string(),
  subcategoryId: z.string().nullable().optional(),
  officeId: z.string().nullable().optional(),
});

export const updateResourceSchema = createResourceSchema.omit({ kind: true }).partial();
```

- [ ] **Step 4: Write `server/src/routes/resources.ts`**

```ts
import { Router, type Request } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { Bookmark } from '../models/Bookmark.js';
import { Resource, toPublicResource, type ResourceDoc } from '../models/Resource.js';
import { createResource, deleteResource, setFeatured, updateResource } from '../services/resourceService.js';
import { createResourceSchema, updateResourceSchema } from '../validators/resources.js';

const PAGE_SIZE = 20;

export const resourcesRouter = Router();
resourcesRouter.use(requireAuth);

function isAdmin(role: string): boolean {
  return role === 'broker' || role === 'officeAdmin';
}

/** Agents: all-users or own office, and file resources only once a file exists
 * (metadata is created before the upload — see resourceService.announceResource).
 * Admins: everything. */
function visibilityFilter(req: Request): Record<string, unknown> {
  const me = req.user!;
  if (isAdmin(me.role)) return {};
  return {
    $and: [
      { $or: [{ officeId: null }, { officeId: me.officeId }] },
      { $or: [{ kind: 'link' }, { 'versions.0': { $exists: true } }] },
    ],
  };
}

export async function loadVisibleResource(req: Request): Promise<ResourceDoc> {
  const resource = await Resource.findOne({ _id: req.params.id, ...visibilityFilter(req) });
  if (!resource) throw new AppError(404, 'Resource not found');
  return resource;
}

/** Adds the viewer's `bookmarked` flag to mapped resources in one query. */
async function withBookmarks(docs: ResourceDoc[], userId: string, includeVersions: boolean) {
  const marked = new Set(
    (await Bookmark.find({ userId, resourceId: { $in: docs.map((d) => d.id) } })).map((b) => String(b.resourceId)),
  );
  return docs.map((d) => ({ ...toPublicResource(d, includeVersions), bookmarked: marked.has(d.id) }));
}

resourcesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const page = Math.max(1, Number(req.query.page) || 1);
    const clauses: Record<string, unknown>[] = [visibilityFilter(req)];
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q) clauses.push({ $text: { $search: q } });
    if (typeof req.query.categoryId === 'string' && req.query.categoryId) {
      // A top-level category folds in its subcategories' resources.
      clauses.push({ $or: [{ categoryId: req.query.categoryId }, { subcategoryId: req.query.categoryId }] });
    }
    if (typeof req.query.fileType === 'string' && req.query.fileType) clauses.push({ fileType: req.query.fileType });
    if (req.query.scope === 'mine') {
      const mine = await Bookmark.find({ userId: me.id }).distinct('resourceId');
      clauses.push({ _id: { $in: mine } });
    }
    const filter = { $and: clauses };
    const [docs, total] = await Promise.all([
      Resource.find(filter).sort({ createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE),
      Resource.countDocuments(filter),
    ]);
    res.json({ resources: await withBookmarks(docs, me.id, isAdmin(me.role)), total, page });
  }),
);

resourcesRouter.get(
  '/featured',
  asyncHandler(async (req, res) => {
    const docs = await Resource.find({ featured: true, ...visibilityFilter(req) }).sort({ updatedAt: -1 }).limit(6);
    res.json({ resources: await withBookmarks(docs, req.user!.id, isAdmin(req.user!.role)) });
  }),
);

resourcesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const resource = await loadVisibleResource(req);
    const [mapped] = await withBookmarks([resource], req.user!.id, isAdmin(req.user!.role));
    res.json({ resource: mapped });
  }),
);

resourcesRouter.post(
  '/',
  requireRole('officeAdmin'),
  validate(createResourceSchema),
  asyncHandler(async (req, res) => {
    const resource = await createResource(req.body, req.user!);
    res.status(201).json({ resource: { ...toPublicResource(resource, true), bookmarked: false } });
  }),
);

resourcesRouter.patch(
  '/:id',
  requireRole('officeAdmin'),
  validate(updateResourceSchema),
  asyncHandler(async (req, res) => {
    const resource = await updateResource(req.params.id, req.body);
    const [mapped] = await withBookmarks([resource], req.user!.id, true);
    res.json({ resource: mapped });
  }),
);

resourcesRouter.delete(
  '/:id',
  requireRole('officeAdmin'),
  asyncHandler(async (req, res) => {
    await deleteResource(req.params.id);
    res.json({ ok: true });
  }),
);

// PRD 5.6: "Broker/Owner marks up to 6 resources as Featured" — broker-only, unlike CRUD.
resourcesRouter.post(
  '/:id/featured',
  requireRole('broker'),
  asyncHandler(async (req, res) => {
    await setFeatured(req.params.id, true);
    res.json({ ok: true });
  }),
);

resourcesRouter.delete(
  '/:id/featured',
  requireRole('broker'),
  asyncHandler(async (req, res) => {
    await setFeatured(req.params.id, false);
    res.json({ ok: true });
  }),
);

resourcesRouter.post(
  '/:id/bookmark',
  asyncHandler(async (req, res) => {
    const resource = await loadVisibleResource(req);
    await Bookmark.updateOne(
      { userId: req.user!.id, resourceId: resource.id },
      { $setOnInsert: { userId: req.user!.id, resourceId: resource.id } },
      { upsert: true },
    );
    res.json({ bookmarked: true });
  }),
);

resourcesRouter.delete(
  '/:id/bookmark',
  asyncHandler(async (req, res) => {
    await Bookmark.deleteOne({ userId: req.user!.id, resourceId: req.params.id });
    res.json({ bookmarked: false });
  }),
);
```

**Route-order caution (repeat of the Stage 3 lesson):** `/featured` MUST be declared before `/:id` or "featured" is parsed as an id.

- [ ] **Step 5: Mount in `server/src/app.ts`**

```ts
import { resourcesRouter } from './routes/resources.js';
```
```ts
app.use('/api/v1/resources', resourcesRouter);
```

- [ ] **Step 6: Run the full server suite**

Run: `npm -w server run test`
Expected: PASS — 188 tests (183 + 5). Typecheck + lint clean.

- [ ] **Step 7: Commit**

```bash
git add server/src/validators/resources.ts server/src/routes/resources.ts server/src/app.ts server/tests/resourceRoutes.test.ts
git commit -m "feat(server): resource hub routes with search, featured, and bookmarks"
```

---

### Task 5: Resource file upload (versioning) + tracked download

**Files:**
- Modify: `server/src/routes/resources.ts` (add upload + download routes)
- Test: `server/tests/resourceFiles.test.ts`

Uploads accept **any file type** up to 50MB (locked decision — private storage + forced attachment disposition is the safety model, not an allowlist). Re-uploading appends a version; the first upload announces the resource (Task 3's `announceResource`). Downloads log the `download` engagement event (PRD 5.6: userId, resourceId, timestamp) and resolve through the storage adapter exactly like task attachments. Admins can fetch a historical version with `?version=N` (1-based); agents always get the current version.

- [ ] **Step 1: Write the failing tests** — create `server/tests/resourceFiles.test.ts`:

```ts
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { EngagementEvent } from '../src/models/EngagementEvent.js';
import { Notification } from '../src/models/Notification.js';
import { User } from '../src/models/User.js';
import { hashPassword } from '../src/utils/password.js';

async function loginAs(app: ReturnType<typeof createApp>, email: string, role: string) {
  await User.create({ email, hashedPassword: await hashPassword('Password1!'), role, displayName: email });
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email, password: 'Password1!' });
  return agent;
}

let catCounter = 0;
async function makeFileResource(admin: ReturnType<typeof request.agent>) {
  const cat = (await admin.post('/api/v1/categories').send({ name: `Cat${catCounter++}` })).body.category;
  const r = (await admin.post('/api/v1/resources').send({ title: 'Guide', kind: 'file', categoryId: cat.id })).body.resource;
  return { resource: r, categoryId: cat.id as string };
}

describe('resource files', () => {
  it('first upload sets fileType, announces to bookmarkers of the category, and makes it agent-visible', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'rf1@x.com', 'officeAdmin');
    const agent = await loginAs(app, 'rf2@x.com', 'agent');
    const { resource: r, categoryId } = await makeFileResource(admin);
    // agent bookmarks ANOTHER resource in the same category to become a category follower
    const peer = (await admin.post('/api/v1/resources').send({ title: 'Peer', kind: 'link', externalUrl: 'https://a.example.com', categoryId })).body.resource;
    await agent.post(`/api/v1/resources/${peer.id}/bookmark`);
    await Notification.deleteMany({});

    expect((await agent.get(`/api/v1/resources/${r.id}`)).status).toBe(404); // fileless → hidden
    const up = await admin.post(`/api/v1/resources/${r.id}/file`).attach('file', Buffer.from('%PDF-1.4 fake'), 'guide.pdf');
    expect(up.status).toBe(200);
    expect(up.body.resource.fileType).toBe('pdf');
    expect(up.body.resource.currentFile.name).toBe('guide.pdf');
    expect((await agent.get(`/api/v1/resources/${r.id}`)).status).toBe(200); // now visible
    expect(await Notification.countDocuments({ type: 'bookmarkedResource' })).toBe(1);
  });

  it('re-upload appends a version (no second announcement); admins see history, agents download current', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'rf3@x.com', 'officeAdmin');
    const agent = await loginAs(app, 'rf4@x.com', 'agent');
    const { resource: r } = await makeFileResource(admin);
    // .txt on purpose: supertest parses text/plain bodies into `res.text`, so the byte
    // assertions below stay simple (a .pdf response would be buffered as binary).
    await admin.post(`/api/v1/resources/${r.id}/file`).attach('file', Buffer.from('v1'), 'w9-2025.txt');
    await Notification.deleteMany({});
    const up2 = await admin.post(`/api/v1/resources/${r.id}/file`).attach('file', Buffer.from('v2!'), 'w9-2026.txt');
    expect(up2.body.resource.versions).toHaveLength(2);
    expect(await Notification.countDocuments({ type: 'bookmarkedResource' })).toBe(0);

    // local driver in tests → res.download streams the CURRENT file
    const dl = await agent.get(`/api/v1/resources/${r.id}/download`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toContain('w9-2026.txt');
    expect(dl.text).toBe('v2!');

    // download engagement logged with userId + resourceId (PRD 5.6). Fire-and-forget → wait a beat.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const events = await EngagementEvent.find({ type: 'download' });
    expect(events).toHaveLength(1);
    expect(events[0].meta).toMatchObject({ resourceId: r.id });

    // version param: agents 403, admins fetch history
    expect((await agent.get(`/api/v1/resources/${r.id}/download?version=1`)).status).toBe(403);
    const old = await admin.get(`/api/v1/resources/${r.id}/download?version=1`);
    expect(old.text).toBe('v1');
  });

  it('guards: upload to a link resource 400; upload by agent 403; download of fileless resource 404', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'rf5@x.com', 'officeAdmin');
    const agent = await loginAs(app, 'rf6@x.com', 'agent');
    const cat = (await admin.post('/api/v1/categories').send({ name: 'LinkCat' })).body.category;
    const link = (await admin.post('/api/v1/resources').send({ title: 'Site', kind: 'link', externalUrl: 'https://a.example.com', categoryId: cat.id })).body.resource;
    expect((await admin.post(`/api/v1/resources/${link.id}/file`).attach('file', Buffer.from('x'), 'a.txt')).status).toBe(400);
    const { resource: r } = await makeFileResource(admin);
    expect((await agent.post(`/api/v1/resources/${r.id}/file`).attach('file', Buffer.from('x'), 'a.txt')).status).toBe(403);
    expect((await admin.get(`/api/v1/resources/${r.id}/download`)).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify failure** (upload/download routes missing → 404s).

- [ ] **Step 3: Add the routes.** In `server/src/routes/resources.ts`, add imports:

```ts
import multer from 'multer';
import { logEngagement } from '../services/engagementService.js';
import { announceResource } from '../services/resourceService.js';
import { makeAttachmentKey, storage } from '../services/storage.js';
import { fileTypeOf } from '../utils/fileType.js';
```

Add below the other constants:

```ts
// PRD 5.6: any file type, 50MB cap. Safety model = private storage + forced attachment
// disposition on download, NOT a type allowlist (unlike task attachments).
const fileUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
```

Add the two routes next to the bookmark routes (both start with `/:id/`, so ordering vs. `/featured` is unaffected):

```ts
resourcesRouter.post(
  '/:id/file',
  requireRole('officeAdmin'),
  fileUpload.single('file'),
  asyncHandler(async (req, res) => {
    const resource = await loadVisibleResource(req);
    if (resource.kind !== 'file') throw new AppError(400, 'Link resources have no file');
    if (!req.file) throw new AppError(400, 'File is required');
    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(-120) || 'file';
    const key = makeAttachmentKey(`resources_${resource.id}`, req.file.originalname);
    await storage.putPrivate(key, req.file.buffer, req.file.mimetype);
    resource.versions.push({
      key,
      name: safeName,
      size: req.file.size,
      contentType: req.file.mimetype,
      uploadedBy: req.user!.id,
    } as never);
    resource.fileType = fileTypeOf(req.file.mimetype, req.file.originalname);
    await resource.save();
    // First file = the moment the resource becomes real for agents (see visibilityFilter).
    if (resource.versions.length === 1) await announceResource(resource, req.user!.id);
    const [mapped] = await withBookmarks([resource], req.user!.id, true);
    res.json({ resource: mapped });
  }),
);

resourcesRouter.get(
  '/:id/download',
  asyncHandler(async (req, res) => {
    const resource = await loadVisibleResource(req);
    if (resource.kind !== 'file') throw new AppError(400, 'Link resources open directly — nothing to download');
    if (resource.versions.length === 0) throw new AppError(404, 'No file uploaded yet');
    let version = resource.versions[resource.versions.length - 1];
    if (typeof req.query.version === 'string' && req.query.version) {
      if (!isAdmin(req.user!.role)) throw new AppError(403, 'Version history is admin-only');
      const idx = Number(req.query.version) - 1; // 1-based, matching the admin UI list
      const picked = resource.versions[idx];
      if (!picked) throw new AppError(404, 'Version not found');
      version = picked;
    }
    logEngagement('download', req.user!.id, { resourceId: resource.id, name: version.name });
    const target = await storage.resolveDownload(version.key, version.name);
    if (target.kind === 'url') {
      res.redirect(302, target.url); // 15-minute presigned R2 URL
    } else {
      res.download(target.path, version.name);
    }
  }),
);
```

- [ ] **Step 4: Run the full server suite**

Run: `npm -w server run test`
Expected: PASS — 191 tests (188 + 3). Typecheck + lint clean.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/resources.ts server/tests/resourceFiles.test.ts
git commit -m "feat(server): resource file versioning and tracked signed-URL downloads"
```

---

### Task 6: Task ↔ resource link (server)

**Files:**
- Modify: `server/src/models/Task.ts` (field + mapper line)
- Modify: `server/src/validators/tasks.ts` (schema line)
- Modify: `server/src/services/taskService.ts` (pass-through)
- Test: extend `server/tests/tasks.test.ts`

PRD 5.7.2 gives tasks a "related resource link". Now that resources exist, wire the field end-to-end. Purely additive — nullable, optional everywhere.

- [ ] **Step 1: Write the failing test** — append to `server/tests/tasks.test.ts`, **reusing that file's existing login and create-task helpers**. Read the neighboring create-task tests first and copy their exact audience shape; the essence:

```ts
it('round-trips relatedResourceId through create and toPublicTask', async () => {
  // …file's standard app + admin login setup…
  const cat = (await admin.post('/api/v1/categories').send({ name: 'TaskDocs' })).body.category;
  const resource = (
    await admin.post('/api/v1/resources').send({ title: 'Checklist', kind: 'link', externalUrl: 'https://a.example.com', categoryId: cat.id })
  ).body.resource;
  const created = await admin.post('/api/v1/tasks').send({
    // …the same minimal valid task payload the neighboring tests use…
    title: 'Read the checklist',
    relatedResourceId: resource.id,
  });
  expect(created.status).toBe(201);
  expect(created.body.task.relatedResourceId).toBe(resource.id);
});
```

- [ ] **Step 2: Run to verify failure** — `npm -w server run test -- tests/tasks.test.ts`. Expected: `relatedResourceId` comes back `undefined` (Zod strips unknown keys).

- [ ] **Step 3: Wire the field.** In `server/src/models/Task.ts` add to the task schema (next to the other top-level fields):

```ts
    relatedResourceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Resource', default: null },
```

and inside the object returned by `toPublicTask`:

```ts
    relatedResourceId: t.relatedResourceId ? String(t.relatedResourceId) : null,
```

In `server/src/validators/tasks.ts` add to `createTaskSchema` (and the update schema if the file has one):

```ts
  relatedResourceId: z.string().nullable().optional(),
```

In `server/src/services/taskService.ts`, inside `createTask`, add to the `Task.create({...})` document:

```ts
    relatedResourceId: input.relatedResourceId ?? null,
```

If the service has an update path, pass the field through there identically.

- [ ] **Step 4: Run the full server suite**

Run: `npm -w server run test`
Expected: PASS — 192 tests (191 + 1). Typecheck + lint clean.

- [ ] **Step 5: Commit**

```bash
git add server/src/models/Task.ts server/src/validators/tasks.ts server/src/services/taskService.ts server/tests/tasks.test.ts
git commit -m "feat(server): link tasks to resources via relatedResourceId"
```

---

### Task 7: Banner model + service

**Files:**
- Create: `server/src/models/Banner.ts`
- Create: `server/src/services/bannerService.ts`
- Test: `server/tests/bannerService.test.ts`

A banner is an image (public upload, like post images) or sanitized rich text, with a CTA, office targeting, and a start/end schedule. "Active" = `startAt <= now <= endAt`. There is no cap on how many are active — the client rotates when more than 3 are (locked decision). `clickCount` is denormalized for the admin list; the engagement log is the analytical source of truth.

- [ ] **Step 1: Write the failing tests** — create `server/tests/bannerService.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Banner, toPublicBanner } from '../src/models/Banner.js';
import { User } from '../src/models/User.js';
import { activeBannersFor, createBanner, duplicateBanner } from '../src/services/bannerService.js';

async function makeUser(email: string, role = 'broker', officeId: string | null = null) {
  return User.create({ email, hashedPassword: 'x', role, displayName: email, officeId });
}

const DAY = 24 * 60 * 60 * 1000;

describe('bannerService', () => {
  it('sanitizes rich-text bodies and validates schedule order', async () => {
    const broker = await makeUser('b1@x.com');
    const banner = await createBanner(
      {
        kind: 'text',
        title: 'Q3 kickoff',
        bodyHtml: '<p>Join us <script>alert(1)</script><strong>Friday</strong></p>',
        ctaLabel: 'RSVP',
        ctaUrl: 'https://example.com/rsvp',
        startAt: new Date(Date.now() - DAY),
        endAt: new Date(Date.now() + DAY),
      },
      broker,
    );
    expect(banner.bodyHtml).toBe('<p>Join us <strong>Friday</strong></p>');
    await expect(
      createBanner(
        { kind: 'text', title: 'Bad', bodyHtml: '<p>x</p>', startAt: new Date(Date.now() + DAY), endAt: new Date() },
        broker,
      ),
    ).rejects.toThrow(/end/i);
  });

  it('activeBannersFor: schedule window + office targeting', async () => {
    const officeA = '64b000000000000000000001';
    const broker = await makeUser('b2@x.com');
    const agentA = await makeUser('b3@x.com', 'agent', officeA);
    const mk = (title: string, offset: [number, number], officeId: string | null = null) =>
      createBanner(
        { kind: 'text', title, bodyHtml: '<p>x</p>', startAt: new Date(Date.now() + offset[0] * DAY), endAt: new Date(Date.now() + offset[1] * DAY), officeId },
        broker,
      );
    await mk('live-everyone', [-1, 1]);
    await mk('live-officeA', [-1, 1], officeA);
    await mk('live-otherOffice', [-1, 1], '64b000000000000000000002');
    await mk('expired', [-3, -1]);
    await mk('future', [1, 3]);

    const forAgent = await activeBannersFor(agentA);
    expect(forAgent.map((b) => b.title).sort()).toEqual(['live-everyone', 'live-officeA']);
    // The homepage slot is office-personal even for admins; the admin LIST route
    // (Task 8) is where everything is visible.
    const forBroker = await activeBannersFor(broker);
    expect(forBroker.map((b) => b.title)).toEqual(['live-everyone']);
  });

  it('duplicate copies fields, resets clicks, suffixes the title', async () => {
    const broker = await makeUser('b4@x.com');
    const original = await createBanner(
      { kind: 'text', title: 'Original', bodyHtml: '<p>x</p>', startAt: new Date(), endAt: new Date(Date.now() + DAY) },
      broker,
    );
    original.clickCount = 42;
    await original.save();
    const copy = await duplicateBanner(original.id, broker);
    expect(copy.title).toBe('Original (copy)');
    expect(copy.clickCount).toBe(0);
    expect(copy.bodyHtml).toBe('<p>x</p>');
    expect(await Banner.countDocuments()).toBe(2);
    expect(toPublicBanner(copy).id).not.toBe(original.id);
  });
});
```

- [ ] **Step 2: Run to verify failure** (modules missing).

- [ ] **Step 3: Write `server/src/models/Banner.ts`**

```ts
import mongoose from 'mongoose';

const bannerSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['image', 'text'], required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    imageUrl: { type: String, default: '' }, // public URL from the uploads route (image banners)
    bodyHtml: { type: String, default: '' }, // sanitized server-side (text banners)
    ctaLabel: { type: String, default: '', maxlength: 40 },
    ctaUrl: { type: String, default: '' },
    officeId: { type: mongoose.Schema.Types.ObjectId, default: null },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Denormalized for the admin list; EngagementEvent is the analytical record.
    clickCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);
bannerSchema.index({ startAt: 1, endAt: 1 });

export const Banner = mongoose.model('Banner', bannerSchema);
export type BannerDoc = InstanceType<typeof Banner>;

export function toPublicBanner(b: BannerDoc) {
  return {
    id: b.id as string,
    kind: b.kind,
    title: b.title,
    imageUrl: b.imageUrl,
    bodyHtml: b.bodyHtml,
    ctaLabel: b.ctaLabel,
    ctaUrl: b.ctaUrl,
    officeId: b.officeId,
    startAt: b.startAt,
    endAt: b.endAt,
    clickCount: b.clickCount,
    createdAt: b.get('createdAt') as Date,
  };
}
```

- [ ] **Step 4: Write `server/src/services/bannerService.ts`**

```ts
import { AppError } from '../middleware/errorHandler.js';
import { Banner, type BannerDoc } from '../models/Banner.js';
import type { UserDoc } from '../models/User.js';
import { sanitizePostHtml } from '../utils/sanitizeHtml.js';

export interface BannerInput {
  kind: 'image' | 'text';
  title: string;
  imageUrl?: string;
  bodyHtml?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  officeId?: string | null;
  startAt: Date;
  endAt: Date;
}

function clean(input: Partial<BannerInput>): Partial<BannerInput> {
  return { ...input, ...(input.bodyHtml !== undefined ? { bodyHtml: sanitizePostHtml(input.bodyHtml) } : {}) };
}

function assertScheduleOrder(startAt: Date, endAt: Date): void {
  if (endAt <= startAt) throw new AppError(400, 'The end date must be after the start date');
}

export async function createBanner(input: BannerInput, creator: UserDoc): Promise<BannerDoc> {
  assertScheduleOrder(input.startAt, input.endAt);
  const doc = clean(input) as BannerInput;
  if (doc.kind === 'text' && !doc.bodyHtml) throw new AppError(400, 'Text banners need content');
  if (doc.kind === 'image' && !doc.imageUrl) throw new AppError(400, 'Image banners need an image');
  return Banner.create({ ...doc, createdBy: creator.id });
}

export async function updateBanner(id: string, patch: Partial<BannerInput>): Promise<BannerDoc> {
  const banner = await Banner.findById(id);
  if (!banner) throw new AppError(404, 'Banner not found');
  Object.assign(banner, clean(patch));
  assertScheduleOrder(banner.startAt, banner.endAt);
  await banner.save();
  return banner;
}

/** Homepage slot: live now + targeted at this viewer's office (or everyone). */
export async function activeBannersFor(user: UserDoc): Promise<BannerDoc[]> {
  const now = new Date();
  return Banner.find({
    startAt: { $lte: now },
    endAt: { $gte: now },
    $or: [{ officeId: null }, { officeId: user.officeId }],
  }).sort({ startAt: 1 });
}

/** PRD 5.5: "duplicated and rescheduled" — the copy keeps the schedule; the admin edits it next. */
export async function duplicateBanner(id: string, creator: UserDoc): Promise<BannerDoc> {
  const banner = await Banner.findById(id);
  if (!banner) throw new AppError(404, 'Banner not found');
  return Banner.create({
    kind: banner.kind,
    title: `${banner.title} (copy)`,
    imageUrl: banner.imageUrl,
    bodyHtml: banner.bodyHtml,
    ctaLabel: banner.ctaLabel,
    ctaUrl: banner.ctaUrl,
    officeId: banner.officeId,
    startAt: banner.startAt,
    endAt: banner.endAt,
    createdBy: creator.id,
  });
}
```

- [ ] **Step 5: Run the full server suite**

Run: `npm -w server run test`
Expected: PASS — 195 tests (192 + 3). Typecheck + lint clean.

- [ ] **Step 6: Commit**

```bash
git add server/src/models/Banner.ts server/src/services/bannerService.ts server/tests/bannerService.test.ts
git commit -m "feat(server): banner model and service with scheduling and office targeting"
```

---

### Task 8: Banner routes + click tracking + image upload

**Files:**
- Create: `server/src/validators/banners.ts`
- Create: `server/src/routes/banners.ts`
- Modify: `server/src/app.ts` (mount)
- Modify: `server/src/routes/uploads.ts` (banner-image endpoint)
- Test: `server/tests/bannerRoutes.test.ts`

- [ ] **Step 1: Write the failing tests** — create `server/tests/bannerRoutes.test.ts`:

```ts
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { Banner } from '../src/models/Banner.js';
import { EngagementEvent } from '../src/models/EngagementEvent.js';
import { User } from '../src/models/User.js';
import { hashPassword } from '../src/utils/password.js';

async function loginAs(app: ReturnType<typeof createApp>, email: string, role: string) {
  await User.create({ email, hashedPassword: await hashPassword('Password1!'), role, displayName: email });
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email, password: 'Password1!' });
  return agent;
}

const DAY = 24 * 60 * 60 * 1000;
const live = { startAt: new Date(Date.now() - DAY).toISOString(), endAt: new Date(Date.now() + DAY).toISOString() };

describe('banner routes', () => {
  it('admin CRUD + duplicate; agents can read active but not manage', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'br1@x.com', 'officeAdmin');
    const agent = await loginAs(app, 'br2@x.com', 'agent');

    const created = await admin.post('/api/v1/banners').send({ kind: 'text', title: 'Promo', bodyHtml: '<p>Go</p>', ctaLabel: 'Open', ctaUrl: 'https://x.example.com', ...live });
    expect(created.status).toBe(201);
    const id = created.body.banner.id;

    expect((await agent.get('/api/v1/banners/active')).body.banners).toHaveLength(1);
    expect((await agent.get('/api/v1/banners')).status).toBe(403);
    expect((await agent.post('/api/v1/banners').send({ kind: 'text', title: 'No', bodyHtml: '<p>x</p>', ...live })).status).toBe(403);

    const dup = await admin.post(`/api/v1/banners/${id}/duplicate`);
    expect(dup.status).toBe(201);
    expect(dup.body.banner.title).toBe('Promo (copy)');
    expect((await admin.get('/api/v1/banners')).body.banners).toHaveLength(2); // admin list includes everything

    const patched = await admin.patch(`/api/v1/banners/${id}`).send({ title: 'Promo 2' });
    expect(patched.body.banner.title).toBe('Promo 2');
    expect((await admin.delete(`/api/v1/banners/${id}`)).status).toBe(200);
    expect(await Banner.countDocuments()).toBe(1);
  });

  it('click endpoint logs bannerClick engagement and bumps the denormalized count', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'br3@x.com', 'broker');
    const agent = await loginAs(app, 'br4@x.com', 'agent');
    const id = (await admin.post('/api/v1/banners').send({ kind: 'text', title: 'C', bodyHtml: '<p>x</p>', ...live })).body.banner.id;

    expect((await agent.post(`/api/v1/banners/${id}/click`)).status).toBe(200);
    expect((await agent.post(`/api/v1/banners/${id}/click`)).status).toBe(200);
    // logEngagement is fire-and-forget — give it a beat
    await new Promise((r) => setTimeout(r, 50));
    expect(await EngagementEvent.countDocuments({ type: 'bannerClick' })).toBe(2);
    expect((await Banner.findById(id))!.clickCount).toBe(2);
  });

  it('banner-image upload: officeAdmin+, image types only', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'br5@x.com', 'officeAdmin');
    const agent = await loginAs(app, 'br6@x.com', 'agent');
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    const ok = await admin.post('/api/v1/uploads/banner-image').attach('file', png, { filename: 'ad.png', contentType: 'image/png' });
    expect(ok.status).toBe(200);
    expect(ok.body.url).toContain('/files/banners/');
    expect((await agent.post('/api/v1/uploads/banner-image').attach('file', png, { filename: 'ad.png', contentType: 'image/png' })).status).toBe(403);
    expect((await admin.post('/api/v1/uploads/banner-image').attach('file', Buffer.from('x'), { filename: 'a.txt', contentType: 'text/plain' })).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify failure** (routes missing).

- [ ] **Step 3: Write `server/src/validators/banners.ts`**

```ts
import { z } from 'zod';

export const createBannerSchema = z.object({
  kind: z.enum(['image', 'text']),
  title: z.string().trim().min(1).max(120),
  imageUrl: z.string().max(500).optional(),
  bodyHtml: z.string().max(5000).optional(),
  ctaLabel: z.string().max(40).optional(),
  // Absolute web URL or internal path ("/resources/…")
  ctaUrl: z
    .string()
    .max(500)
    .refine((u) => !u || u.startsWith('/') || u.startsWith('https://') || u.startsWith('http://'), 'Must be a URL or internal path')
    .optional(),
  officeId: z.string().nullable().optional(),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
});

export const updateBannerSchema = createBannerSchema.omit({ kind: true }).partial();
```

- [ ] **Step 4: Write `server/src/routes/banners.ts`**

```ts
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { Banner, toPublicBanner } from '../models/Banner.js';
import { activeBannersFor, createBanner, duplicateBanner, updateBanner } from '../services/bannerService.js';
import { logEngagement } from '../services/engagementService.js';
import { createBannerSchema, updateBannerSchema } from '../validators/banners.js';

export const bannersRouter = Router();
bannersRouter.use(requireAuth);

// Declared before '/:id' routes; every user reads the homepage slot from here.
bannersRouter.get(
  '/active',
  asyncHandler(async (req, res) => {
    const banners = await activeBannersFor(req.user!);
    res.json({ banners: banners.map(toPublicBanner) });
  }),
);

bannersRouter.post(
  '/:id/click',
  asyncHandler(async (req, res) => {
    const banner = await Banner.findByIdAndUpdate(req.params.id, { $inc: { clickCount: 1 } });
    if (!banner) throw new AppError(404, 'Banner not found');
    logEngagement('bannerClick', req.user!.id, { bannerId: banner.id });
    res.json({ ok: true });
  }),
);

bannersRouter.get(
  '/',
  requireRole('officeAdmin'),
  asyncHandler(async (_req, res) => {
    const banners = await Banner.find().sort({ startAt: -1 });
    res.json({ banners: banners.map(toPublicBanner) });
  }),
);

bannersRouter.post(
  '/',
  requireRole('officeAdmin'),
  validate(createBannerSchema),
  asyncHandler(async (req, res) => {
    const banner = await createBanner(req.body, req.user!);
    res.status(201).json({ banner: toPublicBanner(banner) });
  }),
);

bannersRouter.post(
  '/:id/duplicate',
  requireRole('officeAdmin'),
  asyncHandler(async (req, res) => {
    const banner = await duplicateBanner(req.params.id, req.user!);
    res.status(201).json({ banner: toPublicBanner(banner) });
  }),
);

bannersRouter.patch(
  '/:id',
  requireRole('officeAdmin'),
  validate(updateBannerSchema),
  asyncHandler(async (req, res) => {
    const banner = await updateBanner(req.params.id, req.body);
    res.json({ banner: toPublicBanner(banner) });
  }),
);

bannersRouter.delete(
  '/:id',
  requireRole('officeAdmin'),
  asyncHandler(async (req, res) => {
    const banner = await Banner.findByIdAndDelete(req.params.id);
    if (!banner) throw new AppError(404, 'Banner not found');
    res.json({ ok: true });
  }),
);
```

- [ ] **Step 5: Mount + banner-image upload.** In `server/src/app.ts`:

```ts
import { bannersRouter } from './routes/banners.js';
```
```ts
app.use('/api/v1/banners', bannersRouter);
```

In `server/src/routes/uploads.ts`, add after the `post-image` route (identical shape; PRD 5.5's 5MB image cap matches the shared multer limit):

```ts
uploadsRouter.post(
  '/banner-image',
  requireRole('officeAdmin'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const file = requireImage(req.file);
    const url = await storage.putPublic(makeKey('banners', file.mimetype), file.buffer, file.mimetype);
    res.json({ url });
  }),
);
```

- [ ] **Step 6: Run the full server suite**

Run: `npm -w server run test`
Expected: PASS — 198 tests (195 + 3). Typecheck + lint clean.

- [ ] **Step 7: Commit**

```bash
git add server/src/validators/banners.ts server/src/routes/banners.ts server/src/app.ts server/src/routes/uploads.ts server/tests/bannerRoutes.test.ts
git commit -m "feat(server): banner routes with click tracking and image upload"
```

### Task 9: Client types + hooks

**Files:**
- Modify: `client/src/api/types.ts` (append Stage 4 types + `relatedResourceId` on `TaskInfo`)
- Modify: `client/src/api/hooks.ts` (append Stage 4 hooks)

No dedicated test — hooks are exercised by every page test that follows (same treatment as Stages 2–3). Verification is typecheck + lint + the existing suites staying green.

- [ ] **Step 1: Append to `client/src/api/types.ts`:**

```ts
export interface Category {
  id: string;
  name: string;
  parentId: string | null;
}

export interface ResourceVersion {
  name: string;
  size: number;
  contentType: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface ResourceInfo {
  id: string;
  title: string;
  description: string;
  kind: 'file' | 'link';
  externalUrl: string;
  fileType: string;
  categoryId: string;
  subcategoryId: string | null;
  uploadedBy: string;
  officeId: string | null;
  featured: boolean;
  currentFile: { name: string; size: number; contentType: string } | null;
  bookmarked: boolean;
  versions?: ResourceVersion[]; // present for officeAdmin+ only
  createdAt: string;
  updatedAt: string;
}

export interface BannerInfo {
  id: string;
  kind: 'image' | 'text';
  title: string;
  imageUrl: string;
  bodyHtml: string;
  ctaLabel: string;
  ctaUrl: string;
  officeId: string | null;
  startAt: string;
  endAt: string;
  clickCount: number;
  createdAt: string;
}
```

And add to the existing `TaskInfo` interface:

```ts
  relatedResourceId: string | null;
```

**Ripple check:** any client test building a full `TaskInfo` literal (e.g. the `task()` helper in `DashboardPage.test.tsx`, `TasksPage.test.tsx`) now needs `relatedResourceId: null` added — do it in this task so the suite stays green.

- [ ] **Step 2: Append to `client/src/api/hooks.ts`** (types come from `./types` — extend the existing import):

```ts
export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: async () => (await api.get<{ categories: Category[] }>('/categories')).data.categories,
  });
}

export interface ResourceFilters {
  q?: string;
  categoryId?: string;
  fileType?: string;
  scope?: 'all' | 'mine';
  page?: number;
}

export function useResources(filters: ResourceFilters = {}) {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.categoryId) params.set('categoryId', filters.categoryId);
  if (filters.fileType) params.set('fileType', filters.fileType);
  if (filters.scope === 'mine') params.set('scope', 'mine');
  params.set('page', String(filters.page ?? 1));
  return useQuery({
    queryKey: ['resources', filters],
    queryFn: async () =>
      (await api.get<{ resources: ResourceInfo[]; total: number; page: number }>(`/resources?${params}`)).data,
    placeholderData: keepPreviousData,
  });
}

export function useFeaturedResources() {
  return useQuery({
    queryKey: ['resources', 'featured'],
    queryFn: async () => (await api.get<{ resources: ResourceInfo[] }>('/resources/featured')).data.resources,
  });
}

export function useResource(id: string | undefined) {
  return useQuery({
    queryKey: ['resources', id],
    queryFn: async () => (await api.get<{ resource: ResourceInfo }>(`/resources/${id}`)).data.resource,
    enabled: !!id,
  });
}

export function useResourceMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['resources'] });
  return {
    create: useMutation({
      mutationFn: async (input: Record<string, unknown>) =>
        (await api.post<{ resource: ResourceInfo }>('/resources', input)).data.resource,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: async ({ id, ...patch }: { id: string } & Record<string, unknown>) =>
        (await api.patch<{ resource: ResourceInfo }>(`/resources/${id}`, patch)).data.resource,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: async (id: string) => (await api.delete(`/resources/${id}`)).data,
      onSuccess: invalidate,
    }),
    uploadFile: useMutation({
      mutationFn: async ({ id, file }: { id: string; file: File }) => {
        const form = new FormData();
        form.append('file', file);
        return (await api.post<{ resource: ResourceInfo }>(`/resources/${id}/file`, form)).data.resource;
      },
      onSuccess: invalidate,
    }),
    setFeatured: useMutation({
      mutationFn: async ({ id, featured }: { id: string; featured: boolean }) =>
        featured ? (await api.post(`/resources/${id}/featured`)).data : (await api.delete(`/resources/${id}/featured`)).data,
      onSuccess: invalidate,
    }),
    setBookmark: useMutation({
      mutationFn: async ({ id, bookmarked }: { id: string; bookmarked: boolean }) =>
        bookmarked ? (await api.post(`/resources/${id}/bookmark`)).data : (await api.delete(`/resources/${id}/bookmark`)).data,
      onSuccess: invalidate,
    }),
  };
}

export function useCategoryMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['categories'] });
  return {
    create: useMutation({
      mutationFn: async (input: { name: string; parentId?: string | null }) =>
        (await api.post<{ category: Category }>('/categories', input)).data.category,
      onSuccess: invalidate,
    }),
    rename: useMutation({
      mutationFn: async ({ id, name }: { id: string; name: string }) =>
        (await api.patch<{ category: Category }>(`/categories/${id}`, { name })).data.category,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: async (id: string) => (await api.delete(`/categories/${id}`)).data,
      onSuccess: invalidate,
    }),
  };
}

export function useActiveBanners() {
  return useQuery({
    queryKey: ['banners', 'active'],
    queryFn: async () => (await api.get<{ banners: BannerInfo[] }>('/banners/active')).data.banners,
    staleTime: 60_000,
  });
}

export function useBanners() {
  return useQuery({
    queryKey: ['banners'],
    queryFn: async () => (await api.get<{ banners: BannerInfo[] }>('/banners')).data.banners,
  });
}

export function useBannerMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['banners'] });
  return {
    create: useMutation({
      mutationFn: async (input: Record<string, unknown>) =>
        (await api.post<{ banner: BannerInfo }>('/banners', input)).data.banner,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: async ({ id, ...patch }: { id: string } & Record<string, unknown>) =>
        (await api.patch<{ banner: BannerInfo }>(`/banners/${id}`, patch)).data.banner,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: async (id: string) => (await api.delete(`/banners/${id}`)).data,
      onSuccess: invalidate,
    }),
    duplicate: useMutation({
      mutationFn: async (id: string) => (await api.post<{ banner: BannerInfo }>(`/banners/${id}/duplicate`)).data.banner,
      onSuccess: invalidate,
    }),
  };
}

/** Fire-and-forget click log; navigation happens regardless of logging success. */
export function trackBannerClick(id: string): void {
  void api.post(`/banners/${id}/click`).catch(() => {});
}
```

- [ ] **Step 3: Verify**

Run: `npm -w client run test && npm -w client run typecheck && npm run lint`
Expected: all green — 60 client tests still pass (after the `relatedResourceId: null` ripple fix in test literals).

- [ ] **Step 4: Commit**

```bash
git add client/src/api/types.ts client/src/api/hooks.ts client/src/pages
git commit -m "feat(client): stage 4 types and hooks for resources, categories, banners"
```

---

### Task 10: Resource Hub page + navigation + email pref

**Files:**
- Create: `client/src/pages/ResourceHubPage.tsx`
- Modify: `client/src/App.tsx` (route)
- Modify: `client/src/components/AppShell.tsx` (nav link)
- Modify: `client/src/pages/ProfilePage.tsx` (email pref row)
- Test: `client/src/pages/ResourceHubPage.test.tsx`

Featured tile row (≤6) on top, then search + category/file-type filters, All ↔ My Resources tabs, and the paged list. Each row: title, category, file-type badge, bookmark toggle (star), and Download (file) or Open (link, new tab). Download uses a plain `<a href>` to the API so the browser follows the 302 to the signed URL — the Axios layer must NOT be used for downloads.

- [ ] **Step 1: Write the failing test** — create `client/src/pages/ResourceHubPage.test.tsx` (mock pattern copied from `DashboardPage.test.tsx`):

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ResourceInfo } from '../api/types';
import { ResourceHubPage } from './ResourceHubPage';

const { getMock, postMock, deleteMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(async () => ({ data: {} })),
  deleteMock: vi.fn(async () => ({ data: {} })),
}));
vi.mock('../api/client', () => ({ api: { get: getMock, post: postMock, delete: deleteMock } }));

function resource(overrides: Partial<ResourceInfo>): ResourceInfo {
  return {
    id: 'r1',
    title: 'Guide',
    description: '',
    kind: 'file',
    externalUrl: '',
    fileType: 'pdf',
    categoryId: 'c1',
    subcategoryId: null,
    uploadedBy: 'u1',
    officeId: null,
    featured: false,
    currentFile: { name: 'guide.pdf', size: 100, contentType: 'application/pdf' },
    bookmarked: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function mockApi({ featured = [] as ResourceInfo[], resources = [] as ResourceInfo[] } = {}) {
  getMock.mockImplementation(async (url: string) => {
    if (url === '/auth/me') return { data: { user: { id: 'me', role: 'agent', displayName: 'Me', officeId: null, emailPrefs: {} } } };
    if (url === '/categories') return { data: { categories: [{ id: 'c1', name: 'Marketing', parentId: null }] } };
    if (url === '/resources/featured') return { data: { resources: featured } };
    if (url.startsWith('/resources?')) return { data: { resources, total: resources.length, page: 1 } };
    throw new Error(`unmocked ${url}`);
  });
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/resources']}>
        <ResourceHubPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ResourceHubPage', () => {
  it('renders featured tiles, list rows with download links, and link resources that open externally', async () => {
    mockApi({
      featured: [resource({ id: 'f1', title: 'Star pick', featured: true })],
      resources: [
        resource({ id: 'r1', title: 'Brand PDF' }),
        resource({ id: 'r2', title: 'Portal', kind: 'link', fileType: 'link', externalUrl: 'https://p.example.com', currentFile: null }),
      ],
    });
    render(wrap());
    expect(await screen.findByText('Star pick')).toBeInTheDocument();
    const download = await screen.findByRole('link', { name: /download brand pdf/i });
    expect(download).toHaveAttribute('href', '/api/v1/resources/r1/download');
    const open = screen.getByRole('link', { name: /open portal/i });
    expect(open).toHaveAttribute('href', 'https://p.example.com');
    expect(open).toHaveAttribute('target', '_blank');
  });

  it('toggles a bookmark and switches to My Resources', async () => {
    mockApi({ resources: [resource({ id: 'r1', title: 'Guide' })] });
    render(wrap());
    await userEvent.click(await screen.findByRole('button', { name: /bookmark guide/i }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/resources/r1/bookmark'));
    await userEvent.click(screen.getByRole('button', { name: /my resources/i }));
    await waitFor(() => expect(getMock).toHaveBeenCalledWith(expect.stringContaining('scope=mine')));
  });

  it('search and filters hit the API with the right params; hides the New button from agents', async () => {
    mockApi({ resources: [] });
    render(wrap());
    await screen.findByText(/no resources/i);
    expect(screen.queryByRole('link', { name: /new resource/i })).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox', { name: /search resources/i }), 'contract');
    await waitFor(() => expect(getMock).toHaveBeenCalledWith(expect.stringContaining('q=contract')));
    await userEvent.selectOptions(screen.getByLabelText(/category/i), 'c1');
    await waitFor(() => expect(getMock).toHaveBeenCalledWith(expect.stringContaining('categoryId=c1')));
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm -w client run test -- ResourceHubPage`.

- [ ] **Step 3: Write `client/src/pages/ResourceHubPage.tsx`**

```tsx
import { Bookmark as BookmarkIcon, Download, ExternalLink, FileText, Star } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCategories, useFeaturedResources, useMe, useResourceMutations, useResources } from '../api/hooks';
import type { ResourceInfo } from '../api/types';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';

export const FILE_TYPE_OPTIONS = ['pdf', 'image', 'word', 'excel', 'powerpoint', 'video', 'audio', 'archive', 'text', 'other', 'link'];

/** Primary action for a resource row/tile: browser-native download (follows the API's 302
 * to the signed URL) or external link. Never route these through Axios. */
export function ResourceAction({ resource }: { resource: ResourceInfo }) {
  if (resource.kind === 'link') {
    return (
      <a
        href={resource.externalUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${resource.title}`}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44, fontSize: 14 }}
      >
        <ExternalLink size={16} /> Open
      </a>
    );
  }
  return (
    <a
      href={`/api/v1/resources/${resource.id}/download`}
      aria-label={`Download ${resource.title}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44, fontSize: 14 }}
    >
      <Download size={16} /> Download
    </a>
  );
}

export function ResourceHubPage() {
  const { data: me } = useMe();
  const { data: categories } = useCategories();
  const { data: featured } = useFeaturedResources();
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [fileType, setFileType] = useState('');
  const [scope, setScope] = useState<'all' | 'mine'>('all');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useResources({ q, categoryId, fileType, scope, page });
  const { setBookmark } = useResourceMutations();
  const isAdmin = me && (me.role === 'broker' || me.role === 'officeAdmin');
  const nameOf = (id: string) => (categories ?? []).find((c) => c.id === id)?.name ?? '';

  const bookmarkButton = (r: ResourceInfo) => (
    <button
      type="button"
      aria-label={r.bookmarked ? `Remove bookmark from ${r.title}` : `Bookmark ${r.title}`}
      aria-pressed={r.bookmarked}
      onClick={() => setBookmark.mutate({ id: r.id, bookmarked: !r.bookmarked })}
      style={{ background: 'none', border: 'none', cursor: 'pointer', minWidth: 44, minHeight: 44, color: r.bookmarked ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
    >
      <BookmarkIcon size={18} fill={r.bookmarked ? 'currentColor' : 'none'} />
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <h1 style={{ fontSize: 24, flex: 1 }}>Resource Hub</h1>
        {isAdmin && (
          <Link to="/resources/new">
            <Button>New resource</Button>
          </Link>
        )}
      </div>

      {featured && featured.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--space-3)' }}>
          {featured.map((r) => (
            <Card key={r.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-accent)', fontSize: 12, marginBottom: 4 }}>
                <Star size={14} fill="currentColor" /> Featured
              </div>
              <Link to={`/resources/${r.id}`} style={{ fontWeight: 600, color: 'var(--color-text)' }}>{r.title}</Link>
              <div style={{ marginTop: 'var(--space-2)' }}>
                <ResourceAction resource={r} />
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center' }}>
          <input
            type="search"
            role="searchbox"
            aria-label="Search resources"
            placeholder="Search resources…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            style={{ flex: 1, minWidth: 180, minHeight: 44, padding: '0 var(--space-2)', border: '1px solid var(--color-border)', borderRadius: 8, background: 'var(--color-bg)', color: 'var(--color-text)' }}
          />
          <label style={{ fontSize: 14 }}>
            Category{' '}
            <select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }} style={{ minHeight: 44 }}>
              <option value="">All</option>
              {(categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.parentId ? `— ${c.name}` : c.name}</option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 14 }}>
            Type{' '}
            <select value={fileType} onChange={(e) => { setFileType(e.target.value); setPage(1); }} style={{ minHeight: 44 }}>
              <option value="">All</option>
              {FILE_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <div role="group" aria-label="Scope" style={{ display: 'flex', gap: 4 }}>
            <Button variant={scope === 'all' ? 'primary' : 'secondary'} onClick={() => { setScope('all'); setPage(1); }}>All</Button>
            <Button variant={scope === 'mine' ? 'primary' : 'secondary'} onClick={() => { setScope('mine'); setPage(1); }}>My Resources</Button>
          </div>
        </div>

        {isLoading && <Spinner />}
        {!isLoading && (data?.resources.length ?? 0) === 0 && (
          <p style={{ color: 'var(--color-text-muted)', fontSize: 14, marginTop: 'var(--space-3)' }}>
            No resources {scope === 'mine' ? 'bookmarked yet — tap the bookmark icon on any resource.' : 'match these filters.'}
          </p>
        )}
        {(data?.resources ?? []).map((r) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 52, borderBottom: '1px solid var(--color-border)' }}>
            <FileText size={18} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Link to={`/resources/${r.id}`} style={{ color: 'var(--color-text)', fontWeight: 500 }}>{r.title}</Link>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                {nameOf(r.categoryId)}{r.subcategoryId ? ` / ${nameOf(r.subcategoryId)}` : ''}
              </div>
            </div>
            <Badge tone="neutral">{r.fileType}</Badge>
            {bookmarkButton(r)}
            <ResourceAction resource={r} />
          </div>
        ))}

        {(data?.total ?? 0) > 20 && (
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)', alignItems: 'center' }}>
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <span style={{ fontSize: 14 }}>Page {page}</span>
            <Button variant="secondary" disabled={page * 20 >= (data?.total ?? 0)} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
```

**Check `Button`'s actual prop names** (`variant` values) in `client/src/components/ui/Button.tsx` before using — match whatever exists; if there is no `secondary` variant, use the file's equivalent.

- [ ] **Step 4: Wire route + nav + email pref.**

In `client/src/App.tsx`, next to the other authenticated routes:

```tsx
<Route path="/resources" element={<ResourceHubPage />} />
```

In `client/src/components/AppShell.tsx`, after the Tasks link (import `FolderOpen` from lucide-react):

```tsx
<NavLink to="/resources" style={({ isActive }) => navLinkStyle(isActive)}>
  <FolderOpen size={18} />
  Resources
</NavLink>
```

In `client/src/pages/ProfilePage.tsx`, append to `EMAIL_PREFS`:

```ts
  { key: 'bookmarkedResource', label: 'New resources in categories I follow' },
```

- [ ] **Step 5: Run the client suite**

Run: `npm -w client run test && npm -w client run typecheck && npm run lint`
Expected: PASS — 63 tests (60 + 3).

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/ResourceHubPage.tsx client/src/pages/ResourceHubPage.test.tsx client/src/App.tsx client/src/components/AppShell.tsx client/src/pages/ProfilePage.tsx
git commit -m "feat(client): resource hub page with featured tiles, filters, bookmarks"
```

---

### Task 11: Resource detail + editor pages

**Files:**
- Create: `client/src/pages/ResourceDetailPage.tsx`
- Create: `client/src/pages/ResourceEditorPage.tsx`
- Modify: `client/src/App.tsx` (routes)
- Test: `client/src/pages/ResourceDetailPage.test.tsx`, `client/src/pages/ResourceEditorPage.test.tsx`

Detail: title, description, category path, bookmark toggle, big download/open action; admins additionally get version history (numbered, newest last — `?version=N` download links), a replace-file control, edit/delete, and (broker only) the feature toggle. Editor: create + edit via the `:id` param, kind picker locked after creation, category/subcategory selects (subcategory options filtered by chosen parent), office targeting select (offices come from `useSettings().officeLocations` — same source the task/post editors use; check one of them and mirror it).

- [ ] **Step 1: Write the failing tests.**

`client/src/pages/ResourceDetailPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ResourceInfo } from '../api/types';
import { ResourceDetailPage } from './ResourceDetailPage';

const { getMock, postMock, deleteMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(async () => ({ data: {} })),
  deleteMock: vi.fn(async () => ({ data: {} })),
}));
vi.mock('../api/client', () => ({ api: { get: getMock, post: postMock, delete: deleteMock } }));

const base: ResourceInfo = {
  id: 'r1', title: 'W-9', description: 'Tax form', kind: 'file', externalUrl: '', fileType: 'pdf',
  categoryId: 'c1', subcategoryId: null, uploadedBy: 'u1', officeId: null, featured: false,
  currentFile: { name: 'w9-2026.pdf', size: 120, contentType: 'application/pdf' }, bookmarked: false,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};

function mockApi(role: string, resource: ResourceInfo) {
  getMock.mockImplementation(async (url: string) => {
    if (url === '/auth/me') return { data: { user: { id: 'me', role, displayName: 'Me', officeId: null, emailPrefs: {} } } };
    if (url === '/categories') return { data: { categories: [{ id: 'c1', name: 'Forms', parentId: null }] } };
    if (url === '/resources/r1') return { data: { resource } };
    throw new Error(`unmocked ${url}`);
  });
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/resources/r1']}>
        <Routes>
          <Route path="/resources/:id" element={<ResourceDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ResourceDetailPage', () => {
  it('agents: download + bookmark, no version history or admin controls', async () => {
    mockApi('agent', base);
    render(wrap());
    expect(await screen.findByRole('heading', { name: 'W-9' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /download w-9/i })).toHaveAttribute('href', '/api/v1/resources/r1/download');
    expect(screen.queryByText(/version history/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /bookmark w-9/i }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/resources/r1/bookmark'));
  });

  it('admins: version history with per-version download links + replace-file control', async () => {
    mockApi('officeAdmin', {
      ...base,
      versions: [
        { name: 'w9-2025.pdf', size: 100, contentType: 'application/pdf', uploadedBy: 'u1', uploadedAt: new Date().toISOString() },
        { name: 'w9-2026.pdf', size: 120, contentType: 'application/pdf', uploadedBy: 'u1', uploadedAt: new Date().toISOString() },
      ],
    });
    render(wrap());
    expect(await screen.findByText(/version history/i)).toBeInTheDocument();
    const v1 = screen.getByRole('link', { name: /download version 1/i });
    expect(v1).toHaveAttribute('href', '/api/v1/resources/r1/download?version=1');
    expect(screen.getByLabelText(/replace file/i)).toBeInTheDocument();
  });

  it('broker sees the feature toggle; officeAdmin does not', async () => {
    mockApi('broker', base);
    render(wrap());
    await userEvent.click(await screen.findByRole('button', { name: /feature this resource/i }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/resources/r1/featured'));
  });
});
```

`client/src/pages/ResourceEditorPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ResourceEditorPage } from './ResourceEditorPage';

const { getMock, postMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(async () => ({ data: { resource: { id: 'new1' } } })),
}));
vi.mock('../api/client', () => ({ api: { get: getMock, post: postMock } }));

function mockApi() {
  getMock.mockImplementation(async (url: string) => {
    if (url === '/auth/me') return { data: { user: { id: 'me', role: 'broker', displayName: 'Me', officeId: null, emailPrefs: {} } } };
    if (url === '/categories')
      return {
        data: {
          categories: [
            { id: 'c1', name: 'Forms', parentId: null },
            { id: 'c2', name: 'Tax', parentId: 'c1' },
            { id: 'c3', name: 'Marketing', parentId: null },
            { id: 'c4', name: 'Social', parentId: 'c3' },
          ],
        },
      };
    if (url === '/settings') return { data: { settings: { brandName: 'B', officeLocations: [], rssFeeds: [], welcomeMessage: '', quickLinks: [], homepageLayout: [], reservableResources: [] } } };
    throw new Error(`unmocked ${url}`);
  });
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/resources/new']}>
        <Routes>
          <Route path="/resources/new" element={<ResourceEditorPage />} />
          <Route path="/resources/:id" element={<div>detail page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ResourceEditorPage', () => {
  it('subcategory options track the chosen category', async () => {
    mockApi();
    render(wrap());
    await userEvent.selectOptions(await screen.findByLabelText(/^category/i), 'c1');
    const sub = screen.getByLabelText(/subcategory/i);
    expect(sub).toContainHTML('Tax');
    expect(sub).not.toContainHTML('Social');
  });

  it('creates a link resource and navigates to its detail page', async () => {
    mockApi();
    render(wrap());
    await userEvent.type(await screen.findByLabelText(/title/i), 'Brand portal');
    await userEvent.selectOptions(screen.getByLabelText(/^category/i), 'c1');
    await userEvent.click(screen.getByLabelText(/external link/i));
    await userEvent.type(screen.getByLabelText(/url/i), 'https://brand.example.com');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/resources', expect.objectContaining({ title: 'Brand portal', kind: 'link', externalUrl: 'https://brand.example.com', categoryId: 'c1' })),
    );
    expect(await screen.findByText('detail page')).toBeInTheDocument();
  });

  it('file kind: creates metadata then uploads the chosen file to /resources/:id/file', async () => {
    mockApi();
    render(wrap());
    await userEvent.type(await screen.findByLabelText(/title/i), 'Guide');
    await userEvent.selectOptions(screen.getByLabelText(/^category/i), 'c1');
    const file = new File(['x'], 'guide.pdf', { type: 'application/pdf' });
    await userEvent.upload(screen.getByLabelText(/file/i), file);
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/resources', expect.objectContaining({ kind: 'file' })));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/resources/new1/file', expect.any(FormData)));
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Write `client/src/pages/ResourceDetailPage.tsx`**

```tsx
import { Bookmark as BookmarkIcon, Pencil, Star, Trash2, Upload } from 'lucide-react';
import { isAxiosError } from 'axios';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCategories, useMe, useResource, useResourceMutations } from '../api/hooks';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { ResourceAction } from './ResourceHubPage';

export function ResourceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const { data: resource, isLoading } = useResource(id);
  const { data: categories } = useCategories();
  const { remove, uploadFile, setFeatured, setBookmark } = useResourceMutations();
  const [error, setError] = useState('');
  if (isLoading || !resource || !me) return <Spinner />;
  const isAdmin = me.role === 'broker' || me.role === 'officeAdmin';
  const nameOf = (cid: string | null) => (cid && (categories ?? []).find((c) => c.id === cid)?.name) || '';

  const fail = (err: unknown) =>
    setError(isAxiosError(err) ? (err.response?.data?.error ?? 'Something went wrong') : 'Something went wrong');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: 720 }}>
      {error && <p role="alert" style={{ color: 'var(--color-danger)' }}>{error}</p>}
      <Card>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
              <h1 style={{ fontSize: 22 }}>{resource.title}</h1>
              {resource.featured && <Badge tone="accent"><Star size={12} /> Featured</Badge>}
              <Badge tone="neutral">{resource.fileType}</Badge>
            </div>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
              {nameOf(resource.categoryId)}{resource.subcategoryId ? ` / ${nameOf(resource.subcategoryId)}` : ''}
            </p>
          </div>
          <button
            type="button"
            aria-label={resource.bookmarked ? `Remove bookmark from ${resource.title}` : `Bookmark ${resource.title}`}
            aria-pressed={resource.bookmarked}
            onClick={() => setBookmark.mutate({ id: resource.id, bookmarked: !resource.bookmarked }, { onError: fail })}
            style={{ background: 'none', border: 'none', cursor: 'pointer', minWidth: 44, minHeight: 44, color: resource.bookmarked ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
          >
            <BookmarkIcon size={20} fill={resource.bookmarked ? 'currentColor' : 'none'} />
          </button>
        </div>
        {resource.description && <p style={{ marginTop: 'var(--space-2)', fontSize: 14 }}>{resource.description}</p>}
        <div style={{ marginTop: 'var(--space-3)' }}>
          <ResourceAction resource={resource} />
          {resource.kind === 'file' && resource.currentFile && (
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', marginLeft: 'var(--space-2)' }}>
              {resource.currentFile.name} · {(resource.currentFile.size / 1024).toFixed(0)} KB
            </span>
          )}
        </div>
      </Card>

      {isAdmin && (
        <Card>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
            <Link to={`/resources/${resource.id}/edit`}><Button variant="secondary"><Pencil size={14} /> Edit</Button></Link>
            {me.role === 'broker' && (
              <Button
                variant="secondary"
                onClick={() => setFeatured.mutate({ id: resource.id, featured: !resource.featured }, { onError: fail })}
              >
                <Star size={14} /> {resource.featured ? 'Unfeature' : 'Feature this resource'}
              </Button>
            )}
            <Button
              variant="danger"
              onClick={() => {
                if (window.confirm('Delete this resource? Bookmarks to it are removed too.')) {
                  remove.mutate(resource.id, { onSuccess: () => navigate('/resources'), onError: fail });
                }
              }}
            >
              <Trash2 size={14} /> Delete
            </Button>
          </div>

          {resource.kind === 'file' && (
            <div style={{ marginTop: 'var(--space-3)' }}>
              <h2 style={{ fontSize: 16 }}>Version history</h2>
              <ol style={{ paddingLeft: 'var(--space-4)', fontSize: 14 }}>
                {(resource.versions ?? []).map((v, i) => (
                  <li key={i} style={{ minHeight: 36 }}>
                    <a href={`/api/v1/resources/${resource.id}/download?version=${i + 1}`} aria-label={`Download version ${i + 1}`}>
                      {v.name}
                    </a>{' '}
                    <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                      {new Date(v.uploadedAt).toLocaleDateString()}{i === (resource.versions?.length ?? 0) - 1 ? ' · current' : ''}
                    </span>
                  </li>
                ))}
              </ol>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44, fontSize: 14, cursor: 'pointer' }}>
                <Upload size={16} /> Replace file (new version)
                <input
                  type="file"
                  aria-label="Replace file"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadFile.mutate({ id: resource.id, file }, { onError: fail });
                    e.target.value = '';
                  }}
                />
              </label>
              {uploadFile.isPending && <Spinner />}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write `client/src/pages/ResourceEditorPage.tsx`**

```tsx
import { isAxiosError } from 'axios';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useCategories, useMe, useResource, useResourceMutations, useSettings } from '../api/hooks';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Field } from '../components/ui/Field';

export function ResourceEditorPage() {
  const { id } = useParams(); // undefined on /resources/new
  const navigate = useNavigate();
  const { data: me } = useMe();
  const { data: existing } = useResource(id);
  const { data: categories } = useCategories();
  const { data: settings } = useSettings();
  const { create, update, uploadFile } = useResourceMutations();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<'file' | 'link'>('file');
  const [externalUrl, setExternalUrl] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [officeId, setOfficeId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Write-once seed from the loaded resource (same contract as the other editors).
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (existing && !seeded) {
      setTitle(existing.title);
      setDescription(existing.description);
      setKind(existing.kind);
      setExternalUrl(existing.externalUrl);
      setCategoryId(existing.categoryId);
      setSubcategoryId(existing.subcategoryId ?? '');
      setOfficeId(existing.officeId ?? '');
      setSeeded(true);
    }
  }, [existing, seeded]);

  if (me && me.role !== 'broker' && me.role !== 'officeAdmin') {
    navigate('/resources');
    return null;
  }
  const topLevel = (categories ?? []).filter((c) => !c.parentId);
  const subs = (categories ?? []).filter((c) => c.parentId === categoryId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!title.trim() || !categoryId) {
      setError('Title and category are required');
      return;
    }
    const body = {
      title: title.trim(),
      description,
      externalUrl: kind === 'link' ? externalUrl : undefined,
      categoryId,
      subcategoryId: subcategoryId || null,
      officeId: officeId || null,
    };
    setSaving(true);
    try {
      if (id) {
        await update.mutateAsync({ id, ...body });
        navigate(`/resources/${id}`);
      } else {
        const created = await create.mutateAsync({ ...body, kind });
        if (kind === 'file' && file) await uploadFile.mutateAsync({ id: created.id, file });
        navigate(`/resources/${created.id}`);
      }
    } catch (err) {
      setError(isAxiosError(err) ? (err.response?.data?.error ?? 'Save failed') : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <h1 style={{ fontSize: 22, marginBottom: 'var(--space-3)' }}>{id ? 'Edit resource' : 'New resource'}</h1>
      {error && <p role="alert" style={{ color: 'var(--color-danger)' }}>{error}</p>}
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', maxWidth: 560 }}>
        <Field label="Title" id="res-title">
          <input id="res-title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
        </Field>
        <Field label="Description" id="res-desc">
          <textarea id="res-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000} />
        </Field>
        <Field label="Category" id="res-cat">
          <select id="res-cat" value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setSubcategoryId(''); }} required>
            <option value="">Choose…</option>
            {topLevel.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Subcategory (optional)" id="res-sub">
          <select id="res-sub" value={subcategoryId} onChange={(e) => setSubcategoryId(e.target.value)} disabled={subs.length === 0}>
            <option value="">None</option>
            {subs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Audience" id="res-office">
          <select id="res-office" value={officeId} onChange={(e) => setOfficeId(e.target.value)}>
            <option value="">All users</option>
            {(settings?.officeLocations ?? []).map((o: { _id?: string; id?: string; name: string }) => (
              <option key={o._id ?? o.id} value={o._id ?? o.id}>{o.name}</option>
            ))}
          </select>
        </Field>

        {!id && (
          <fieldset style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 'var(--space-3)' }}>
            <legend style={{ fontSize: 14, padding: '0 6px' }}>Resource type</legend>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, fontSize: 14 }}>
              <input type="radio" name="kind" checked={kind === 'file'} onChange={() => setKind('file')} /> File upload (up to 50MB)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, fontSize: 14 }}>
              <input type="radio" name="kind" aria-label="External link" checked={kind === 'link'} onChange={() => setKind('link')} /> External link
            </label>
          </fieldset>
        )}

        {kind === 'link' && (
          <Field label="URL" id="res-url">
            <input id="res-url" type="url" value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder="https://…" required />
          </Field>
        )}
        {kind === 'file' && !id && (
          <Field label="File" id="res-file">
            <input id="res-file" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
        )}
        {kind === 'file' && id && (
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Replace the file from the resource page — each replacement becomes a new version.</p>
        )}

        <div>
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Card>
  );
}
```

**Check `Field`'s actual API** in `client/src/components/ui/Field.tsx` (it may render its own label/input wiring) and adjust — labels must remain programmatically associated for the tests' `getByLabelText` to work. Check the `officeLocations` element shape in `client/src/api/types.ts` and reuse it instead of the inline shape above if one exists.

- [ ] **Step 5: Routes.** In `client/src/App.tsx`:

```tsx
<Route path="/resources/new" element={<ResourceEditorPage />} />
<Route path="/resources/:id" element={<ResourceDetailPage />} />
<Route path="/resources/:id/edit" element={<ResourceEditorPage />} />
```

(`/resources/new` must precede `/resources/:id`? React Router 6 ranks static segments higher automatically — order is safe either way, but keep this order for readability.)

- [ ] **Step 6: Run the client suite**

Run: `npm -w client run test && npm -w client run typecheck && npm run lint`
Expected: PASS — 69 tests (63 + 6).

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/ResourceDetailPage.tsx client/src/pages/ResourceDetailPage.test.tsx client/src/pages/ResourceEditorPage.tsx client/src/pages/ResourceEditorPage.test.tsx client/src/App.tsx
git commit -m "feat(client): resource detail with version history and resource editor"
```

---

### Task 12: Admin categories page

**Files:**
- Create: `client/src/pages/admin/CategoriesPage.tsx`
- Modify: `client/src/App.tsx` (route)
- Modify: `client/src/components/AppShell.tsx` (admin nav link)
- Test: `client/src/pages/admin/CategoriesPage.test.tsx`

Two-level tree editor: top-level categories with inline rename, an "add subcategory" input under each, and delete buttons that surface the server's guard errors (children/resources present → 400 message shown in an alert region). Nav link goes in the ADMIN section — visible to officeAdmin+ (i.e. NOT inside the `isBroker` gate; mirror how the Users link is placed).

- [ ] **Step 1: Write the failing test** — create `client/src/pages/admin/CategoriesPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CategoriesPage } from './CategoriesPage';

const { getMock, postMock, deleteMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(async () => ({ data: { category: { id: 'new', name: 'X', parentId: null } } })),
  deleteMock: vi.fn(),
}));
vi.mock('../../api/client', () => ({ api: { get: getMock, post: postMock, delete: deleteMock, patch: vi.fn(async () => ({ data: {} })) } }));

function mockApi() {
  getMock.mockImplementation(async (url: string) => {
    if (url === '/auth/me') return { data: { user: { id: 'me', role: 'broker', displayName: 'Me', officeId: null, emailPrefs: {} } } };
    if (url === '/categories')
      return {
        data: {
          categories: [
            { id: 'c1', name: 'Marketing', parentId: null },
            { id: 'c2', name: 'Social', parentId: 'c1' },
          ],
        },
      };
    throw new Error(`unmocked ${url}`);
  });
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CategoriesPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('CategoriesPage', () => {
  it('renders the tree and adds a top-level category', async () => {
    mockApi();
    render(wrap());
    expect(await screen.findByText('Marketing')).toBeInTheDocument();
    expect(screen.getByText('Social')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/new category/i), 'Compliance');
    await userEvent.click(screen.getByRole('button', { name: /add category/i }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/categories', { name: 'Compliance', parentId: null }));
  });

  it('adds a subcategory under its parent', async () => {
    mockApi();
    render(wrap());
    await userEvent.type(await screen.findByLabelText(/add subcategory to marketing/i), 'Email');
    // The button's name deliberately differs from the input's ("under" vs "to") so the
    // two accessible names never collide in getByLabelText.
    await userEvent.click(screen.getByRole('button', { name: /add subcategory under marketing/i }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/categories', { name: 'Email', parentId: 'c1' }));
  });

  it('surfaces the server guard message when deletion is refused', async () => {
    mockApi();
    deleteMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { error: 'Move or delete the resources in this category first' } },
    });
    render(wrap());
    await userEvent.click(await screen.findByRole('button', { name: /delete social/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/resources in this category/i);
  });
});
```

**Note:** if the mocked rejection shape doesn't satisfy `isAxiosError` in your Axios version, mock `axios.isAxiosError` the way neighboring admin-page tests do — copy their exact approach.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Write `client/src/pages/admin/CategoriesPage.tsx`**

```tsx
import { isAxiosError } from 'axios';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useCategories, useCategoryMutations } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Spinner } from '../../components/ui/Spinner';

export function CategoriesPage() {
  const { data: categories, isLoading } = useCategories();
  const { create, rename, remove } = useCategoryMutations();
  const [newName, setNewName] = useState('');
  const [subNames, setSubNames] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState('');
  if (isLoading) return <Spinner />;
  const topLevel = (categories ?? []).filter((c) => !c.parentId);
  const childrenOf = (id: string) => (categories ?? []).filter((c) => c.parentId === id);
  const fail = (err: unknown) =>
    setError(isAxiosError(err) ? (err.response?.data?.error ?? 'Something went wrong') : 'Something went wrong');

  const nameRow = (c: { id: string; name: string }, label: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 44 }}>
      {editing?.id === c.id ? (
        <>
          <input
            aria-label={`Rename ${c.name}`}
            value={editing.name}
            onChange={(e) => setEditing({ id: c.id, name: e.target.value })}
            style={{ flex: 1 }}
          />
          <Button
            variant="secondary"
            aria-label={`Save name for ${c.name}`}
            onClick={() => rename.mutate({ id: c.id, name: editing.name }, { onSuccess: () => setEditing(null), onError: fail })}
          >
            <Check size={14} />
          </Button>
          <Button variant="secondary" aria-label="Cancel rename" onClick={() => setEditing(null)}><X size={14} /></Button>
        </>
      ) : (
        <>
          <span style={{ flex: 1, fontSize: 14 }}>{label}</span>
          <button
            type="button"
            aria-label={`Rename ${c.name}`}
            onClick={() => { setError(''); setEditing({ id: c.id, name: c.name }); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', minWidth: 44, minHeight: 44, color: 'var(--color-text-muted)' }}
          >
            <Pencil size={15} />
          </button>
          <button
            type="button"
            aria-label={`Delete ${c.name}`}
            onClick={() => { setError(''); remove.mutate(c.id, { onError: fail }); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', minWidth: 44, minHeight: 44, color: 'var(--color-danger)' }}
          >
            <Trash2 size={15} />
          </button>
        </>
      )}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: 640 }}>
      <h1 style={{ fontSize: 24 }}>Resource categories</h1>
      {error && <p role="alert" style={{ color: 'var(--color-danger)' }}>{error}</p>}

      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            setError('');
            create.mutate({ name: newName.trim(), parentId: null }, { onSuccess: () => setNewName(''), onError: fail });
          }}
          style={{ display: 'flex', gap: 'var(--space-2)' }}
        >
          <input aria-label="New category name" placeholder="New category…" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ flex: 1, minHeight: 44 }} />
          <Button type="submit" aria-label="Add category"><Plus size={14} /> Add</Button>
        </form>
      </Card>

      {topLevel.map((cat) => (
        <Card key={cat.id}>
          {nameRow(cat, cat.name)}
          <div style={{ paddingLeft: 'var(--space-4)', borderLeft: '2px solid var(--color-border)', marginLeft: 'var(--space-2)' }}>
            {childrenOf(cat.id).map((sub) => nameRow(sub, sub.name))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const name = (subNames[cat.id] ?? '').trim();
                if (!name) return;
                setError('');
                create.mutate({ name, parentId: cat.id }, { onSuccess: () => setSubNames((s) => ({ ...s, [cat.id]: '' })), onError: fail });
              }}
              style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}
            >
              <input
                aria-label={`Add subcategory to ${cat.name}`}
                placeholder="New subcategory…"
                value={subNames[cat.id] ?? ''}
                onChange={(e) => setSubNames((s) => ({ ...s, [cat.id]: e.target.value }))}
                style={{ flex: 1, minHeight: 44 }}
              />
              <Button type="submit" variant="secondary" aria-label={`Add subcategory under ${cat.name}`}><Plus size={14} /></Button>
            </form>
          </div>
        </Card>
      ))}
      {topLevel.length === 0 && <p style={{ color: 'var(--color-text-muted)' }}>No categories yet — resources need at least one.</p>}
    </div>
  );
}
```

**React key warning:** `nameRow` is called inside `.map` — wrap the subcategory call as `<div key={sub.id}>{nameRow(sub, sub.name)}</div>` (and rely on `Card key` for parents) or add keyed wrappers; do whichever keeps the console clean.

- [ ] **Step 4: Route + nav.** In `client/src/App.tsx`, next to the other `/admin/*` routes and wrapped in the same guard those use:

```tsx
<Route path="/admin/categories" element={<CategoriesPage />} />
```

In `client/src/components/AppShell.tsx`, inside the ADMIN section but OUTSIDE the `isBroker` gate (officeAdmins manage categories too — PRD 5.6.2), import `FolderTree` from lucide-react:

```tsx
<NavLink to="/admin/categories" style={({ isActive }) => navLinkStyle(isActive)}>
  <FolderTree size={18} />
  Categories
</NavLink>
```

- [ ] **Step 5: Run the client suite**

Run: `npm -w client run test && npm -w client run typecheck && npm run lint`
Expected: PASS — 72 tests (69 + 3).

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/admin/CategoriesPage.tsx client/src/pages/admin/CategoriesPage.test.tsx client/src/App.tsx client/src/components/AppShell.tsx
git commit -m "feat(client): admin category management page"
```

### Task 13: BannerSlot component on the dashboard

**Files:**
- Create: `client/src/components/BannerSlot.tsx`
- Modify: `client/src/pages/DashboardPage.tsx` (render the slot at the top)
- Test: `client/src/components/BannerSlot.test.tsx`

PRD 5.5 semantics, locked earlier: up to 3 banners visible at once; more than 3 active → the visible window advances by one every 5 seconds, wrapping; zero active → the component renders nothing (graceful collapse — no empty frame). Clicking a banner logs `bannerClick` (fire-and-forget `trackBannerClick`) and then follows the CTA: external URLs open in a new tab, internal paths use the router.

- [ ] **Step 1: Write the failing test** — create `client/src/components/BannerSlot.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BannerInfo } from '../api/types';
import { BannerSlot } from './BannerSlot';

const { getMock, postMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(async () => ({ data: {} })),
}));
vi.mock('../api/client', () => ({ api: { get: getMock, post: postMock } }));

function banner(i: number, overrides: Partial<BannerInfo> = {}): BannerInfo {
  return {
    id: `b${i}`, kind: 'text', title: `Banner ${i}`, imageUrl: '', bodyHtml: `<p>Body ${i}</p>`,
    ctaLabel: 'Open', ctaUrl: 'https://x.example.com', officeId: null,
    startAt: new Date().toISOString(), endAt: new Date().toISOString(), clickCount: 0,
    createdAt: new Date().toISOString(), ...overrides,
  };
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <BannerSlot />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('BannerSlot', () => {
  it('collapses to nothing when no banners are active', async () => {
    getMock.mockResolvedValue({ data: { banners: [] } });
    const { container } = render(wrap());
    await act(async () => {}); // let the query settle
    expect(container).toBeEmptyDOMElement();
  });

  it('shows up to 3 banners statically (no timer churn)', async () => {
    getMock.mockResolvedValue({ data: { banners: [banner(1), banner(2)] } });
    render(wrap());
    expect(await screen.findByText('Banner 1')).toBeInTheDocument();
    expect(screen.getByText('Banner 2')).toBeInTheDocument();
  });

  it('rotates the visible window every 5s when more than 3 are active', async () => {
    vi.useFakeTimers();
    getMock.mockResolvedValue({ data: { banners: [banner(1), banner(2), banner(3), banner(4)] } });
    render(wrap());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText('Banner 1')).toBeInTheDocument();
    expect(screen.queryByText('Banner 4')).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.queryByText('Banner 1')).not.toBeInTheDocument();
    expect(screen.getByText('Banner 4')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('clicking logs the bannerClick and opens the CTA in a new tab', async () => {
    getMock.mockResolvedValue({ data: { banners: [banner(1)] } });
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(wrap());
    await userEvent.click(await screen.findByRole('button', { name: /banner 1/i }));
    expect(postMock).toHaveBeenCalledWith('/banners/b1/click');
    expect(open).toHaveBeenCalledWith('https://x.example.com', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Write `client/src/components/BannerSlot.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { trackBannerClick, useActiveBanners } from '../api/hooks';
import type { BannerInfo } from '../api/types';

const VISIBLE = 3;
const ROTATE_MS = 5000;

/** Homepage banner slot (PRD 5.5). ≤3 active → static; >3 → the 3-wide window advances
 * one banner every 5s, wrapping. Renders nothing when no banner is active. */
export function BannerSlot() {
  const { data: banners } = useActiveBanners();
  const navigate = useNavigate();
  const [offset, setOffset] = useState(0);
  const count = banners?.length ?? 0;

  useEffect(() => {
    if (count <= VISIBLE) return;
    const timer = setInterval(() => setOffset((o) => (o + 1) % count), ROTATE_MS);
    return () => clearInterval(timer);
  }, [count]);

  if (!banners || count === 0) return null;
  const visible = count <= VISIBLE ? banners : Array.from({ length: VISIBLE }, (_, i) => banners[(offset + i) % count]);

  const follow = (b: BannerInfo) => {
    trackBannerClick(b.id);
    if (!b.ctaUrl) return;
    if (b.ctaUrl.startsWith('/')) navigate(b.ctaUrl);
    else window.open(b.ctaUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div role="region" aria-label="Announcements" style={{ display: 'grid', gridTemplateColumns: `repeat(${visible.length}, 1fr)`, gap: 'var(--space-3)' }}>
      {visible.map((b) => (
        <button
          key={b.id}
          type="button"
          aria-label={b.ctaLabel ? `${b.title} — ${b.ctaLabel}` : b.title}
          onClick={() => follow(b)}
          style={{
            textAlign: 'left', cursor: b.ctaUrl ? 'pointer' : 'default', minHeight: 88, padding: 0,
            border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden',
            background: 'var(--color-surface)', color: 'var(--color-text)',
          }}
        >
          {b.kind === 'image' ? (
            <img src={b.imageUrl} alt={b.title} style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }} />
          ) : (
            <div style={{ padding: 'var(--space-3)' }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{b.title}</div>
              {/* Server-sanitized via sanitizePostHtml — same trust boundary as post bodies. */}
              <div style={{ fontSize: 13 }} dangerouslySetInnerHTML={{ __html: b.bodyHtml }} />
              {b.ctaLabel && <span style={{ color: 'var(--color-accent)', fontSize: 13, fontWeight: 600 }}>{b.ctaLabel} →</span>}
            </div>
          )}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Mount on the dashboard.** In `client/src/pages/DashboardPage.tsx`, import and render `<BannerSlot />` as the FIRST child of the page's column flex container (above the welcome heading — it's the ad slot). Existing dashboard tests mock `api.get` by URL; add `if (url === '/banners/active') return { data: { banners: [] } };` to their mock implementations so they keep passing.

- [ ] **Step 5: Run the client suite**

Run: `npm -w client run test && npm -w client run typecheck && npm run lint`
Expected: PASS — 76 tests (72 + 4).

- [ ] **Step 6: Commit**

```bash
git add client/src/components/BannerSlot.tsx client/src/components/BannerSlot.test.tsx client/src/pages/DashboardPage.tsx client/src/pages/DashboardPage.test.tsx
git commit -m "feat(client): rotating homepage banner slot with click tracking"
```

---

### Task 14: Admin banners page

**Files:**
- Create: `client/src/pages/admin/BannersPage.tsx`
- Modify: `client/src/App.tsx` (route)
- Modify: `client/src/components/AppShell.tsx` (admin nav link)
- Test: `client/src/pages/admin/BannersPage.test.tsx`

A table of all banners (title, kind, schedule, live/expired/scheduled status badge, click count) with Duplicate/Edit/Delete per row, plus an editor form (shown for "New banner" and when editing): kind radio, title, image upload (posts to `/uploads/banner-image`, stores the returned URL) or rich-text body via the existing `RichTextEditor`, CTA label + URL, office select, start/end `datetime-local` inputs.

- [ ] **Step 1: Write the failing test** — create `client/src/pages/admin/BannersPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { BannerInfo } from '../../api/types';
import { BannersPage } from './BannersPage';

const { getMock, postMock, deleteMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(async (url: string) => ({ data: url.includes('duplicate') ? { banner: { id: 'copy' } } : { banner: { id: 'new1' } } })),
  deleteMock: vi.fn(async () => ({ data: {} })),
}));
vi.mock('../../api/client', () => ({ api: { get: getMock, post: postMock, delete: deleteMock, patch: vi.fn(async () => ({ data: {} })) } }));
// The rich text editor drags in TipTap; the form only needs its value contract.
vi.mock('../../components/RichTextEditor', () => ({
  RichTextEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea aria-label="Banner body" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

const DAY = 24 * 60 * 60 * 1000;
function banner(overrides: Partial<BannerInfo>): BannerInfo {
  return {
    id: 'b1', kind: 'text', title: 'Promo', imageUrl: '', bodyHtml: '<p>x</p>', ctaLabel: '', ctaUrl: '',
    officeId: null, startAt: new Date(Date.now() - DAY).toISOString(), endAt: new Date(Date.now() + DAY).toISOString(),
    clickCount: 7, createdAt: new Date().toISOString(), ...overrides,
  };
}

function mockApi(banners: BannerInfo[]) {
  getMock.mockImplementation(async (url: string) => {
    if (url === '/auth/me') return { data: { user: { id: 'me', role: 'broker', displayName: 'Me', officeId: null, emailPrefs: {} } } };
    if (url === '/banners') return { data: { banners } };
    if (url === '/settings') return { data: { settings: { brandName: 'B', officeLocations: [], rssFeeds: [], welcomeMessage: '', quickLinks: [], homepageLayout: [], reservableResources: [] } } };
    throw new Error(`unmocked ${url}`);
  });
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <BannersPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('BannersPage', () => {
  it('lists banners with status and click counts; duplicate calls the endpoint', async () => {
    // b2 gets clickCount 0 so the '7' assertion below matches exactly one element.
    mockApi([banner({}), banner({ id: 'b2', title: 'Old', clickCount: 0, startAt: new Date(Date.now() - 3 * DAY).toISOString(), endAt: new Date(Date.now() - DAY).toISOString() })]);
    render(wrap());
    expect(await screen.findByText('Promo')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument(); // click count
    await userEvent.click(screen.getByRole('button', { name: /duplicate promo/i }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/banners/b1/duplicate'));
  });

  it('creates a text banner from the form', async () => {
    mockApi([]);
    render(wrap());
    await userEvent.click(await screen.findByRole('button', { name: /new banner/i }));
    await userEvent.type(screen.getByLabelText(/title/i), 'Summer push');
    await userEvent.type(screen.getByLabelText(/banner body/i), '<p>Go</p>');
    // fireEvent.change, not userEvent.type — typing into datetime-local inputs is unreliable in jsdom.
    fireEvent.change(screen.getByLabelText(/start/i), { target: { value: '2026-08-01T09:00' } });
    fireEvent.change(screen.getByLabelText(/end/i), { target: { value: '2026-08-15T17:00' } });
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/banners', expect.objectContaining({ kind: 'text', title: 'Summer push', bodyHtml: '<p>Go</p>' })),
    );
  });

  it('deletes after confirmation', async () => {
    mockApi([banner({})]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(wrap());
    await userEvent.click(await screen.findByRole('button', { name: /delete promo/i }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('/banners/b1'));
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Write `client/src/pages/admin/BannersPage.tsx`**

```tsx
import { isAxiosError } from 'axios';
import { Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api/client';
import { useBannerMutations, useBanners, useSettings } from '../../api/hooks';
import type { BannerInfo } from '../../api/types';
import { RichTextEditor } from '../../components/RichTextEditor';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Spinner } from '../../components/ui/Spinner';

function statusOf(b: BannerInfo): { label: string; tone: 'success' | 'neutral' | 'warning' } {
  const now = Date.now();
  if (new Date(b.endAt).getTime() < now) return { label: 'Expired', tone: 'neutral' };
  if (new Date(b.startAt).getTime() > now) return { label: 'Scheduled', tone: 'warning' };
  return { label: 'Live', tone: 'success' };
}

/** ISO → the local-time string a datetime-local input expects. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const EMPTY = { kind: 'text' as 'text' | 'image', title: '', imageUrl: '', bodyHtml: '', ctaLabel: '', ctaUrl: '', officeId: '', startAt: '', endAt: '' };

export function BannersPage() {
  const { data: banners, isLoading } = useBanners();
  const { data: settings } = useSettings();
  const { create, update, remove, duplicate } = useBannerMutations();
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  if (isLoading) return <Spinner />;
  const fail = (err: unknown) =>
    setError(isAxiosError(err) ? (err.response?.data?.error ?? 'Something went wrong') : 'Something went wrong');

  const openEditor = (b?: BannerInfo) => {
    setError('');
    setEditingId(b?.id ?? null);
    setForm(
      b
        ? { kind: b.kind, title: b.title, imageUrl: b.imageUrl, bodyHtml: b.bodyHtml, ctaLabel: b.ctaLabel, ctaUrl: b.ctaUrl, officeId: b.officeId ?? '', startAt: toLocalInput(b.startAt), endAt: toLocalInput(b.endAt) }
        : { ...EMPTY },
    );
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setError('');
    const body = {
      ...(editingId ? {} : { kind: form.kind }),
      title: form.title,
      imageUrl: form.imageUrl,
      bodyHtml: form.bodyHtml,
      ctaLabel: form.ctaLabel,
      ctaUrl: form.ctaUrl,
      officeId: form.officeId || null,
      startAt: form.startAt ? new Date(form.startAt).toISOString() : '',
      endAt: form.endAt ? new Date(form.endAt).toISOString() : '',
    };
    const done = { onSuccess: () => { setForm(null); setEditingId(null); }, onError: fail };
    if (editingId) update.mutate({ id: editingId, ...body }, done);
    else create.mutate(body, done);
  };

  const uploadImage = async (file: File) => {
    setUploading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post<{ url: string }>('/uploads/banner-image', fd);
      setForm((f) => (f ? { ...f, imageUrl: data.url } : f));
    } catch (err) {
      fail(err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <h1 style={{ fontSize: 24, flex: 1 }}>Banner ads</h1>
        <Button onClick={() => openEditor()}><Plus size={14} /> New banner</Button>
      </div>
      {error && <p role="alert" style={{ color: 'var(--color-danger)' }}>{error}</p>}

      {form && (
        <Card>
          <h2 style={{ fontSize: 18, marginBottom: 'var(--space-3)' }}>{editingId ? 'Edit banner' : 'New banner'}</h2>
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', maxWidth: 560 }}>
            {!editingId && (
              <fieldset style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 'var(--space-3)' }}>
                <legend style={{ fontSize: 14, padding: '0 6px' }}>Banner type</legend>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, fontSize: 14 }}>
                  <input type="radio" name="bkind" checked={form.kind === 'text'} onChange={() => setForm({ ...form, kind: 'text' })} /> Rich text
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, fontSize: 14 }}>
                  <input type="radio" name="bkind" checked={form.kind === 'image'} onChange={() => setForm({ ...form, kind: 'image' })} /> Image (≤5MB)
                </label>
              </fieldset>
            )}
            <Field label="Title" id="bn-title">
              <input id="bn-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={120} />
            </Field>
            {form.kind === 'image' ? (
              <Field label="Image" id="bn-image">
                <input id="bn-image" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage(f); }} />
                {uploading && <Spinner />}
                {form.imageUrl && <img src={form.imageUrl} alt="Banner preview" style={{ maxWidth: '100%', maxHeight: 120, marginTop: 8, borderRadius: 8 }} />}
              </Field>
            ) : (
              <div>
                <span style={{ fontSize: 14, display: 'block', marginBottom: 4 }}>Body</span>
                <RichTextEditor value={form.bodyHtml} onChange={(bodyHtml) => setForm((f) => (f ? { ...f, bodyHtml } : f))} />
              </div>
            )}
            <Field label="CTA label (optional)" id="bn-cta-label">
              <input id="bn-cta-label" value={form.ctaLabel} onChange={(e) => setForm({ ...form, ctaLabel: e.target.value })} maxLength={40} />
            </Field>
            <Field label="CTA link (URL or internal path)" id="bn-cta-url">
              <input id="bn-cta-url" value={form.ctaUrl} onChange={(e) => setForm({ ...form, ctaUrl: e.target.value })} placeholder="https://… or /resources/…" />
            </Field>
            <Field label="Audience" id="bn-office">
              <select id="bn-office" value={form.officeId} onChange={(e) => setForm({ ...form, officeId: e.target.value })}>
                <option value="">All users</option>
                {(settings?.officeLocations ?? []).map((o: { _id?: string; id?: string; name: string }) => (
                  <option key={o._id ?? o.id} value={o._id ?? o.id}>{o.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Start" id="bn-start">
              <input id="bn-start" type="datetime-local" value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} required />
            </Field>
            <Field label="End" id="bn-end">
              <input id="bn-end" type="datetime-local" value={form.endAt} onChange={(e) => setForm({ ...form, endAt: e.target.value })} required />
            </Field>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <Button type="submit">Save</Button>
              <Button type="button" variant="secondary" onClick={() => { setForm(null); setEditingId(null); }}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        {(banners ?? []).length === 0 && <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>No banners yet.</p>}
        {(banners ?? []).map((b) => {
          const s = statusOf(b);
          return (
            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 52, borderBottom: '1px solid var(--color-border)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 500, fontSize: 14 }}>{b.title}</span>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                  {b.kind} · {new Date(b.startAt).toLocaleDateString()} – {new Date(b.endAt).toLocaleDateString()}
                </div>
              </div>
              <Badge tone={s.tone}>{s.label}</Badge>
              <span title="Clicks" aria-label={`${b.clickCount} clicks`} style={{ fontSize: 14, minWidth: 32, textAlign: 'right' }}>{b.clickCount}</span>
              <button type="button" aria-label={`Duplicate ${b.title}`} onClick={() => duplicate.mutate(b.id, { onError: fail })} style={{ background: 'none', border: 'none', cursor: 'pointer', minWidth: 44, minHeight: 44, color: 'var(--color-text-muted)' }}>
                <Copy size={16} />
              </button>
              <button type="button" aria-label={`Edit ${b.title}`} onClick={() => openEditor(b)} style={{ background: 'none', border: 'none', cursor: 'pointer', minWidth: 44, minHeight: 44, color: 'var(--color-text-muted)' }}>
                <Pencil size={16} />
              </button>
              <button
                type="button"
                aria-label={`Delete ${b.title}`}
                onClick={() => { if (window.confirm('Delete this banner?')) remove.mutate(b.id, { onError: fail }); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', minWidth: 44, minHeight: 44, color: 'var(--color-danger)' }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
```

**Check `Badge`'s tone values** in `client/src/components/ui/Badge.tsx` — use the file's actual union (the tests above assert only the label text, so tones can be adjusted freely).

- [ ] **Step 4: Route + nav.** In `client/src/App.tsx` (same admin guard wrapper as the other `/admin/*` routes):

```tsx
<Route path="/admin/banners" element={<BannersPage />} />
```

In `client/src/components/AppShell.tsx`, ADMIN section, OUTSIDE the `isBroker` gate (officeAdmins manage banners — PRD 5.5), import `Megaphone`… already imported for Message Board; use `Image` from lucide-react instead:

```tsx
<NavLink to="/admin/banners" style={({ isActive }) => navLinkStyle(isActive)}>
  <Image size={18} />
  Banners
</NavLink>
```

(`Image` shadows the DOM global in this file scope only if referenced as a value elsewhere — it isn't; if lint complains, alias the import: `Image as ImageIcon`.)

- [ ] **Step 5: Run the client suite**

Run: `npm -w client run test && npm -w client run typecheck && npm run lint`
Expected: PASS — 79 tests (76 + 3).

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/admin/BannersPage.tsx client/src/pages/admin/BannersPage.test.tsx client/src/App.tsx client/src/components/AppShell.tsx
git commit -m "feat(client): admin banner management with duplicate and click counts"
```

---

### Task 15: Task ↔ resource link (client)

**Files:**
- Modify: `client/src/pages/TaskEditorPage.tsx` (related-resource select)
- Modify: `client/src/pages/TaskDetailPage.tsx` (related-resource link)
- Test: extend `client/src/pages/TaskDetailPage.test.tsx`

- [ ] **Step 1: Write the failing test** — append to `client/src/pages/TaskDetailPage.test.tsx` (reuse the file's existing mock helpers; the task fixture already gained `relatedResourceId: null` in Task 9 — override it here):

```tsx
it('links to the related resource when the task has one', async () => {
  // extend the file's api.get mock: '/resources/r9' → { data: { resource: { id: 'r9', title: 'Buyer checklist', kind: 'link', externalUrl: 'https://x.example.com', /* …fill the ResourceInfo shape used in ResourceHubPage.test.tsx… */ } } }
  // and the task under test gets relatedResourceId: 'r9'
  // …file's standard render…
  const link = await screen.findByRole('link', { name: /buyer checklist/i });
  expect(link).toHaveAttribute('href', '/resources/r9');
});
```

Match the file's existing mock and render helpers exactly — this is a sketch of the assertion, not of the setup.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: TaskDetailPage.** In `client/src/pages/TaskDetailPage.tsx`, load the resource when the task references one and render a link in the task metadata block (near due date/priority):

```tsx
const { data: relatedResource } = useResource(task?.relatedResourceId ?? undefined);
```
```tsx
{relatedResource && (
  <p style={{ fontSize: 14 }}>
    Related resource:{' '}
    <Link to={`/resources/${relatedResource.id}`}>{relatedResource.title}</Link>
  </p>
)}
```

(`useResource` is `enabled: !!id`, so tasks without a resource fire no request.)

- [ ] **Step 4: TaskEditorPage.** In `client/src/pages/TaskEditorPage.tsx`, add state seeded like the other fields, a select fed by the resource list, and include the value in the create/update payload:

```tsx
const [relatedResourceId, setRelatedResourceId] = useState('');
const { data: resourceList } = useResources({ page: 1 });
```
```tsx
<Field label="Related resource (optional)" id="task-resource">
  <select id="task-resource" value={relatedResourceId} onChange={(e) => setRelatedResourceId(e.target.value)}>
    <option value="">None</option>
    {(resourceList?.resources ?? []).map((r) => (
      <option key={r.id} value={r.id}>{r.title}</option>
    ))}
  </select>
</Field>
```

In the submit payload: `relatedResourceId: relatedResourceId || null`. If the editor seeds from an existing task, seed this field too. (First page of resources only — a brokerage's hub is small; revisit if it ever paginates meaningfully. Note this limit in a code comment.) TaskEditorPage tests that mock `api.get` by URL need the `/resources?…` case added, returning `{ data: { resources: [], total: 0, page: 1 } }`.

- [ ] **Step 5: Run the client suite**

Run: `npm -w client run test && npm -w client run typecheck && npm run lint`
Expected: PASS — 80 tests (79 + 1).

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/TaskEditorPage.tsx client/src/pages/TaskDetailPage.tsx client/src/pages/TaskDetailPage.test.tsx
git commit -m "feat(client): related-resource picker on tasks"
```

---

### Task 16: Finish — docs, verification, smoke

**Files:**
- Modify: `README.md` (feature list)
- Modify: `docs/superpowers/plans/2026-07-09-roadmap.md` (plan link)
- No new env vars this stage — `.env.example` is already complete.

- [ ] **Step 1: README.** Add to the feature list (match the existing section's voice):

```markdown
- **Resource Hub** — two-level categories, file (≤50MB, versioned) or link resources, office targeting, keyword search + filters, up to 6 featured tiles, bookmarks with a My Resources view, signed-URL downloads with engagement logging, and "new resource in a category I follow" notifications.
- **Banner ads** — image or rich-text homepage banners with CTA, scheduling, office targeting, 5-second rotation when more than three are live, and click tracking visible in the admin view.
```

- [ ] **Step 2: Roadmap link.** In `docs/superpowers/plans/2026-07-09-roadmap.md` change the Stage 4 heading to:

```markdown
## Stage 4 — Content ✦ plan: `2026-07-11-stage-4-content.md`
```

- [ ] **Step 3: Full verification.**

```bash
npm run lint
npm -w server run typecheck && npm -w server run test
npm -w client run typecheck && npm -w client run test
npm run build
```

Expected: lint clean; server 198 tests; client 80 tests; both builds succeed. If any count differs, reconcile before proceeding — a lower count means a task skipped a test.

- [ ] **Step 4: Live smoke test** (controller runs this against an ephemeral in-memory Mongo with throwaway credentials — NEVER against the real Atlas DB; kill stale daemons on ports 3000/5173 first). Headline flows to verify end-to-end:
  1. Broker creates category "Marketing" + subcategory "Templates" in `/admin/categories`.
  2. Broker creates a file resource, uploads a PDF → hub lists it with a `pdf` badge; downloading streams it back with the right filename; the download appears in `engagementevents`.
  3. Replace the file → detail (admin) shows two versions; `?version=1` returns the original bytes.
  4. Agent bookmarks it → My Resources shows it; broker adds a second resource to Marketing → agent gets the `bookmarkedResource` bell notification and it appears in the feed.
  5. Broker features it → featured tile row renders on `/resources`.
  6. Broker creates a live text banner with a CTA → dashboard shows it; clicking navigates and `bannerclick` engagement + clickCount land; admin list shows the count; Duplicate creates "(copy)".
  7. Create 4 live banners → dashboard rotates the window after 5s.
  8. Task editor: attach a related resource → task detail links to it.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/superpowers/plans/2026-07-09-roadmap.md
git commit -m "docs: stage 4 notes and roadmap link"
```

---

## Deferred / carried backlog (do NOT implement this stage)

- Retention jobs, pageView logging, dashboard widget assembly + homepage layout config → Stage 5 (per roadmap).
- Group targeting for resources/banners → PRD Phase 2.
- Insights dashboard consuming download/click engagement data → PRD Phase 2.
- Carried from earlier stages: dummy-scrypt timing hardening, focus traps, RR v7 future flags, admin-set avatars route, task DELETE / complete-on-behalf client UI, calendar grid a11y, grouped onboarding notifications.

## Execution notes for the controller

- Subagent-driven execution, same protocol as Stages 2–3: fresh implementer per task → spec review → quality review → fix rounds → final whole-implementation review → live smoke test.
- Implementers on Tasks 6, 10–15 MUST read the named neighboring files/tests before writing — several steps explicitly defer to existing shapes (task audience payload, `Field`/`Button`/`Badge` APIs, admin route guard wrapper, test mock helpers).
- Machine gotchas: MONGODB_URI stays non-SRV; kill stale tsx/vite daemons on ports 3000/5173 before dev servers; the user's real `.env` has `STORAGE_DRIVER=r2` — tests use the local driver via test env, and any live smoke MUST use throwaway env values, never the real `.env`.



