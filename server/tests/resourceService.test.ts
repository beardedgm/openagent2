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
    await Bookmark.create({ userId: broker.id, resourceId: seed.id });
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
