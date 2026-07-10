import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AppError } from '../middleware/errorHandler.js';
import { Invitation } from '../models/Invitation.js';
import { getSettings } from '../models/Settings.js';
import { User, type UserDoc } from '../models/User.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { verifyTurnstile } from '../utils/turnstile.js';
import { emitActivity } from './activityService.js';
import { invitationAcceptedEmail } from './emailService.js';
import { logEngagement } from './engagementService.js';
import { notify } from './notificationService.js';

function regenerate(req: Request): Promise<void> {
  return new Promise((resolve, reject) =>
    req.session.regenerate((err) => (err ? reject(err) : resolve())),
  );
}

export async function login(
  req: Request,
  input: { email: string; password: string; turnstileToken?: string },
): Promise<UserDoc> {
  if (!(await verifyTurnstile(input.turnstileToken, req.ip))) throw new AppError(400, 'Bot check failed');
  const user = await User.findOne({ email: input.email.toLowerCase() });
  const invalid = new AppError(401, 'Invalid email or password');
  if (!user || !(await verifyPassword(input.password, user.hashedPassword))) throw invalid;
  if (user.status !== 'active') throw invalid;
  await regenerate(req);
  req.session.userId = user.id;
  user.lastLoginAt = new Date();
  await user.save();
  logEngagement('login', user.id);
  return user;
}

export async function register(
  req: Request,
  input: { token: string; password: string; displayName: string; turnstileToken?: string },
): Promise<UserDoc> {
  if (!(await verifyTurnstile(input.turnstileToken, req.ip))) throw new AppError(400, 'Bot check failed');
  const tokenHash = createHash('sha256').update(input.token).digest('hex');
  const invitation = await Invitation.findOne({ tokenHash });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date())
    throw new AppError(400, 'This invitation link is invalid or has expired');
  if (await User.findOne({ email: invitation.email }))
    throw new AppError(409, 'An account with this email already exists');
  const claimed = await Invitation.findOneAndUpdate(
    { tokenHash, acceptedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { acceptedAt: new Date() } },
  );
  if (!claimed) throw new AppError(400, 'This invitation link is invalid or has expired');
  const user = await User.create({
    email: invitation.email,
    hashedPassword: await hashPassword(input.password),
    role: invitation.role,
    officeId: invitation.officeId,
    displayName: input.displayName,
  });
  await regenerate(req);
  req.session.userId = user.id;
  logEngagement('login', user.id);
  // Side effects must never fail a registration that already created the account.
  try {
    const settings = await getSettings();
    await emitActivity({
      type: 'agentJoined',
      message: `${user.displayName} joined ${settings.brandName}`,
      link: `/profile/${user.id}`,
      actorId: user.id,
    });
    await notify(
      [String(invitation.invitedBy)],
      { type: 'invitationAccepted', title: `${user.displayName} accepted your invitation`, link: `/profile/${user.id}` },
      invitationAcceptedEmail(user.displayName, `${env.APP_DOMAIN}/profile/${user.id}`),
    );
  } catch (err) {
    logger.error(err, 'post-registration side effects failed');
  }
  // Stage 3 wiring: auto-assign Settings.onboardingTaskTemplateId once Tasks exist.
  return user;
}

export function logout(req: Request): Promise<void> {
  return new Promise((resolve, reject) => req.session.destroy((err) => (err ? reject(err) : resolve())));
}
