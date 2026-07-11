import { describe, expect, it } from 'vitest';
import { Bookmark } from '../src/models/Bookmark.js';
import { Category } from '../src/models/Category.js';
import { Notification } from '../src/models/Notification.js';
import { Resource } from '../src/models/Resource.js';
import { User } from '../src/models/User.js';
import { announceResource, createResource, deleteResource, setFeatured, updateResource } from '../src/services/resourceService.js';

async function makeUser(email: string, role = 'agent', officeId: string | null = null) {
  return User.create({ email, hashedPassword: 'x', role, displayName: email, officeId });
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

  it('office-targeted resources announce only to bookmarkers who can see them', async () => {
    const officeA = '64b000000000000000000001';
    const officeB = '64b000000000000000000002';
    const broker = await makeUser('rs9@x.com', 'broker');
    const fanA = await makeUser('rs10@x.com', 'agent', officeA);
    const fanB = await makeUser('rs11@x.com', 'agent', officeB);
    const cat = await Category.create({ name: 'Marketing' });

    // both fans follow the category via bookmarks on an existing all-users resource
    const seed = await createResource({ title: 'Old kit', kind: 'link', externalUrl: 'https://a.example.com', categoryId: cat.id }, broker);
    await Bookmark.create({ userId: fanA.id, resourceId: seed.id });
    await Bookmark.create({ userId: fanB.id, resourceId: seed.id });
    await Notification.deleteMany({});

    await createResource({ title: 'Office A playbook', kind: 'link', externalUrl: 'https://b.example.com', categoryId: cat.id, officeId: officeA }, broker);
    const notes = await Notification.find({ type: 'bookmarkedResource' });
    expect(notes).toHaveLength(1);
    expect(String(notes[0].userId)).toBe(fanA.id); // fanB cannot see the resource, so no bell/email
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
