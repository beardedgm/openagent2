import { Resend } from 'resend';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!resend) {
    logger.info({ to, subject, html }, 'email (console driver)');
    return;
  }
  await resend.emails.send({ from: env.EMAIL_FROM, to, subject, html });
}

export function invitationEmail(brandName: string, link: string): { subject: string; html: string } {
  return {
    subject: `You're invited to join ${brandName}`,
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <h2>${brandName}</h2>
      <p>You've been invited to the ${brandName} workspace.</p>
      <p><a href="${link}" style="display:inline-block;background:#1d4ed8;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none">Accept invitation</a></p>
      <p style="color:#64748b;font-size:13px">This link expires in 7 days. If you weren't expecting it, you can ignore this email.</p>
    </div>`,
  };
}
