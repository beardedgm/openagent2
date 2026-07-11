import mongoose from 'mongoose';
import { User } from '../models/User.js';
import type { AudienceType } from '../models/Task.js';

export interface Audience {
  type: AudienceType;
  userIds: (string | mongoose.Types.ObjectId)[];
  officeId: string | mongoose.Types.ObjectId | null;
}

/** Snapshot resolution (PRD 5.7.2): returns ACTIVE intranet member ids for the audience
 * at this moment. Callers create one completion record per returned id; users added to
 * the office later are NOT retro-included in existing tasks. */
export async function resolveAudience(audience: Audience): Promise<mongoose.Types.ObjectId[]> {
  const base = { status: 'active', role: { $in: ['broker', 'officeAdmin', 'agent'] } };
  if (audience.type === 'all') {
    return (await User.find(base).select('_id')).map((u) => u._id);
  }
  if (audience.type === 'office') {
    return (await User.find({ ...base, officeId: audience.officeId }).select('_id')).map((u) => u._id);
  }
  return (await User.find({ ...base, _id: { $in: audience.userIds } }).select('_id')).map((u) => u._id);
}
