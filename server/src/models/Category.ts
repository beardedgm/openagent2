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
