import mongoose from 'mongoose';

export const ROLES = ['broker', 'officeAdmin', 'agent', 'tc', 'external'] as const;
export type Role = (typeof ROLES)[number];
// tc/external are dormant Phase 2 roles (PRD §3); rank 0 = no intranet access.
export const ROLE_RANK: Record<Role, number> = { external: 0, tc: 0, agent: 1, officeAdmin: 2, broker: 3 };

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    hashedPassword: { type: String, required: true },
    role: { type: String, enum: ROLES, required: true },
    officeId: { type: mongoose.Schema.Types.ObjectId, default: null },
    status: { type: String, enum: ['active', 'deactivated'], default: 'active', index: true },
    displayName: { type: String, required: true },
    phone: { type: String, default: '' },
    photoUrl: { type: String, default: '' },
    bio: { type: String, default: '' },
    emailPrefs: { type: Map, of: Boolean, default: {} },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const User = mongoose.model('User', userSchema);
export type UserDoc = InstanceType<typeof User>;

export function toPublicUser(u: UserDoc) {
  return {
    id: u.id as string,
    email: u.email,
    role: u.role,
    officeId: u.officeId,
    status: u.status,
    displayName: u.displayName,
    phone: u.phone,
    photoUrl: u.photoUrl,
    bio: u.bio,
    emailPrefs: Object.fromEntries((u.emailPrefs as Map<string, boolean> | undefined) ?? []),
    lastLoginAt: u.lastLoginAt,
    createdAt: u.get('createdAt') as Date,
  };
}
