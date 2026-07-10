import { describe, expect, it } from 'vitest';
import { Comment } from '../src/models/Comment.js';
import { Post } from '../src/models/Post.js';
import { User } from '../src/models/User.js';

describe('Post model', () => {
  it('applies defaults', async () => {
    const u = await User.create({ email: 'a@x.com', hashedPassword: 'x', role: 'broker', displayName: 'a' });
    const p = await Post.create({ title: 'Hello', authorId: u.id });
    expect(p.officeId).toBeNull();
    expect(p.important).toBe(false);
    expect(p.commentsEnabled).toBe(true);
    expect(p.pinnedAt).toBeNull();
    expect(p.notifiedAt).toBeNull();
    expect(p.publishAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('supports keyword text search over title and bodyText', async () => {
    const u = await User.create({ email: 'b@x.com', hashedPassword: 'x', role: 'broker', displayName: 'b' });
    await Post.create({ title: 'Commission update', bodyText: 'new split schedule', authorId: u.id });
    await Post.create({ title: 'Holiday party', bodyText: 'rooftop venue', authorId: u.id });
    await Post.init(); // ensure the text index exists before querying it
    const hits = await Post.find({ $text: { $search: 'rooftop' } });
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toBe('Holiday party');
  });
});

describe('Comment model', () => {
  it('stores a flat comment against a post', async () => {
    const u = await User.create({ email: 'c@x.com', hashedPassword: 'x', role: 'agent', displayName: 'c' });
    const p = await Post.create({ title: 'T', authorId: u.id });
    const c = await Comment.create({ postId: p.id, authorId: u.id, body: 'Nice!' });
    expect(c.body).toBe('Nice!');
  });
});
