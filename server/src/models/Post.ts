import mongoose from 'mongoose';

const postSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    bodyHtml: { type: String, default: '' },
    // Plain-text shadow of bodyHtml — powers $text search and list excerpts.
    bodyText: { type: String, default: '' },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    officeId: { type: mongoose.Schema.Types.ObjectId, default: null },
    important: { type: Boolean, default: false },
    commentsEnabled: { type: Boolean, default: true },
    pinnedAt: { type: Date, default: null },
    publishAt: { type: Date, default: () => new Date() },
    // Set exactly once when publish side effects (feed event + notifications) have run.
    notifiedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
postSchema.index({ title: 'text', bodyText: 'text' });
postSchema.index({ pinnedAt: -1, publishAt: -1 });

export const Post = mongoose.model('Post', postSchema);
export type PostDoc = InstanceType<typeof Post>;

type PopulatedAuthor = { _id: mongoose.Types.ObjectId; displayName: string; photoUrl: string } | null;

/** Callers must .populate('authorId', 'displayName photoUrl') first. */
export function toPublicPost(p: PostDoc) {
  const a = p.authorId as unknown as PopulatedAuthor;
  return {
    id: p.id as string,
    title: p.title,
    bodyHtml: p.bodyHtml,
    excerpt: p.bodyText.slice(0, 200),
    author: a ? { id: String(a._id), displayName: a.displayName, photoUrl: a.photoUrl } : null,
    officeId: p.officeId,
    important: p.important,
    commentsEnabled: p.commentsEnabled,
    pinnedAt: p.pinnedAt,
    publishAt: p.publishAt,
    createdAt: p.get('createdAt') as Date,
  };
}
