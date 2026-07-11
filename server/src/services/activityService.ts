import { ActivityEvent, type ActivityType } from '../models/ActivityEvent.js';

export async function emitActivity(input: {
  type: ActivityType;
  message: string;
  link?: string;
  officeId?: string | null;
  actorId?: string | null;
}): Promise<void> {
  await ActivityEvent.create({
    type: input.type,
    message: input.message,
    link: input.link ?? '',
    officeId: input.officeId ?? null,
    actorId: input.actorId ?? null,
  });
}
