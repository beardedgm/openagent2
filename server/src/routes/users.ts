import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { Invitation } from '../models/Invitation.js';
import { toPublicUser, User } from '../models/User.js';
import { createInvitation, resendInvitation } from '../services/invitationService.js';
import { inviteSchema, updateUserSchema } from '../validators/users.js';

export const usersRouter = Router();
usersRouter.use(requireAuth);

function isAdmin(role: string): boolean {
  return role === 'broker' || role === 'officeAdmin';
}

usersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const includeDeactivated = isAdmin(req.user!.role) && req.query.includeDeactivated === 'true';
    const users = await User.find(includeDeactivated ? {} : { status: 'active' }).sort({ displayName: 1 });
    res.json({ users: users.map(toPublicUser) });
  }),
);

usersRouter.post(
  '/invite',
  requireRole('officeAdmin'),
  validate(inviteSchema),
  asyncHandler(async (req, res) => {
    if (req.body.role === 'broker' && req.user!.role !== 'broker')
      throw new AppError(403, 'Only a broker can invite another broker');
    const { invitation, emailSent } = await createInvitation(req.body, req.user!.id);
    res.status(201).json({
      invitation: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
      },
      emailSent,
    });
  }),
);

usersRouter.get(
  '/invitations',
  requireRole('officeAdmin'),
  asyncHandler(async (_req, res) => {
    const invitations = await Invitation.find({ acceptedAt: null }).sort({ createdAt: -1 });
    res.json({
      invitations: invitations.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        officeId: i.officeId,
        expiresAt: i.expiresAt,
      })),
    });
  }),
);

usersRouter.post(
  '/invitations/:id/resend',
  requireRole('officeAdmin'),
  asyncHandler(async (req, res) => {
    const { invitation, emailSent } = await resendInvitation(req.params.id);
    res.json({ invitation: { id: invitation.id, email: invitation.email, expiresAt: invitation.expiresAt }, emailSent });
  }),
);

usersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) throw new AppError(404, 'User not found');
    res.json({ user: toPublicUser(user) });
  }),
);

usersRouter.patch(
  '/:id',
  validate(updateUserSchema),
  asyncHandler(async (req, res) => {
    const target = await User.findById(req.params.id);
    if (!target) throw new AppError(404, 'User not found');
    const me = req.user!;
    const isSelf = target.id === me.id;
    if (!isSelf && !isAdmin(me.role)) throw new AppError(403, 'Insufficient permissions');
    const { role, officeId, ...profile } = req.body;
    if (role !== undefined || officeId !== undefined) {
      if (!isAdmin(me.role)) throw new AppError(403, 'Insufficient permissions');
      if ((role === 'broker' || target.role === 'broker') && me.role !== 'broker')
        throw new AppError(403, 'Only a broker can change broker roles');
      if (target.role === 'broker' && role !== undefined && role !== 'broker') {
        const activeBrokers = await User.countDocuments({ role: 'broker', status: 'active' });
        if (activeBrokers <= 1) throw new AppError(400, 'Cannot remove the last active broker');
      }
      if (role !== undefined) target.role = role;
      if (officeId !== undefined) target.officeId = officeId as never;
    }
    Object.assign(target, profile);
    await target.save();
    res.json({ user: toPublicUser(target) });
  }),
);

usersRouter.delete(
  '/:id',
  requireRole('officeAdmin'),
  asyncHandler(async (req, res) => {
    const target = await User.findById(req.params.id);
    if (!target) throw new AppError(404, 'User not found');
    if (target.id === req.user!.id) throw new AppError(400, 'You cannot deactivate your own account');
    if (target.role === 'broker' && req.user!.role !== 'broker')
      throw new AppError(403, 'Only a broker can deactivate a broker');
    target.status = 'deactivated';
    await target.save();
    res.json({ user: toPublicUser(target) });
  }),
);
