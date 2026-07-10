import { logger } from '../config/logger.js';
import { Notification, type NotificationType } from '../models/Notification.js';
import { User } from '../models/User.js';
import { sendEmail } from './emailService.js';

export interface NotifyEmail {
  subject: string;
  html: string;
  /** PRD 5.9.3 — e.g. task-overdue emails ignore user prefs (Stage 3). */
  nonDisableable?: boolean;
}

export async function notify(
  userIds: string[],
  input: { type: NotificationType; title: string; link?: string },
  email?: NotifyEmail,
): Promise<void> {
  if (userIds.length === 0) return;
  await Notification.insertMany(
    userIds.map((userId) => ({ userId, type: input.type, title: input.title, link: input.link ?? '' })),
  );
  if (!email) return;
  const users = await User.find({ _id: { $in: userIds }, status: 'active' });
  for (const u of users) {
    const wantsEmail = (u.emailPrefs as Map<string, boolean>).get(input.type) ?? true;
    if (!email.nonDisableable && !wantsEmail) continue;
    try {
      await sendEmail(u.email, email.subject, email.html);
    } catch (err) {
      // A dead email provider must never fail the triggering action (post publish, registration).
      logger.error(err, 'notification email failed');
    }
  }
}
