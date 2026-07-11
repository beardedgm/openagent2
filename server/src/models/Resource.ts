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
