import { createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AppError } from '../middleware/errorHandler.js';
import { Invitation, type InvitationDoc } from '../models/Invitation.js';
import { getSettings } from '../models/Settings.js';
import { User, type Role } from '../models/User.js';
import { invitationEmail, sendEmail } from './emailService.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function issueAndSend(invitation: InvitationDoc): Promise<boolean> {
  const token = randomBytes(32).toString('base64url');
  invitation.tokenHash = createHash('sha256').update(token).digest('hex');
  invitation.expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await invitation.save();
  const settings = await getSettings();
  const link = `${env.APP_DOMAIN}/register?token=${token}`;
  const { subject, html } = invitationEmail(settings.brandName, link);
  try {
    return await sendEmail(invitation.email, subject, html);
  } catch (err) {
    logger.error(err, 'invitation email failed');
    return false;
  }
}

export async function createInvitation(
  input: { email: string; role: Role; officeId?: string | null },
  invitedById: string,
): Promise<{ invitation: InvitationDoc; emailSent: boolean }> {
  const email = input.email.toLowerCase();
  if (await User.findOne({ email })) throw new AppError(409, 'A user with this email already exists');
  if (await Invitation.findOne({ email, acceptedAt: null }))
    throw new AppError(409, 'An invitation for this email is already pending');
  const invitation = new Invitation({
    email,
    role: input.role,
    officeId: input.officeId ?? null,
    invitedBy: invitedById,
    tokenHash: `pending:${randomBytes(8).toString('hex')}`,
    expiresAt: new Date(),
  });
  const emailSent = await issueAndSend(invitation);
  return { invitation, emailSent };
}

export async function resendInvitation(id: string): Promise<{ invitation: InvitationDoc; emailSent: boolean }> {
  const invitation = await Invitation.findById(id);
  if (!invitation || invitation.acceptedAt) throw new AppError(404, 'Invitation not found');
  const emailSent = await issueAndSend(invitation);
  return { invitation, emailSent };
}
