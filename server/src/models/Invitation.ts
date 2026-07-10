import mongoose from 'mongoose';
import { ROLES } from './User.js';

const invitationSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    role: { type: String, enum: ROLES, required: true },
    officeId: { type: mongoose.Schema.Types.ObjectId, default: null },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    acceptedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const Invitation = mongoose.model('Invitation', invitationSchema);
export type InvitationDoc = InstanceType<typeof Invitation>;
