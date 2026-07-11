import mongoose from 'mongoose';

const commentSchema = new mongoose.Schema(
  {
    postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true, index: true },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
  },
  { timestamps: true },
);

export const Comment = mongoose.model('Comment', commentSchema);
export type CommentDoc = InstanceType<typeof Comment>;

type PopulatedAuthor = { _id: mongoose.Types.ObjectId; displayName: string; photoUrl: string } | null;

/** Callers must .populate('authorId', 'displayName photoUrl') first. */
export function toPublicComment(c: CommentDoc) {
  const a = c.authorId as unknown as PopulatedAuthor;
  return {
    id: c.id as string,
    body: c.body,
    author: a ? { id: String(a._id), displayName: a.displayName, photoUrl: a.photoUrl } : null,
    createdAt: c.get('createdAt') as Date,
  };
}
