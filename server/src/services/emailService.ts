import { Resend } from 'resend';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!resend) {
    if (env.NODE_ENV === 'production') {
      logger.warn({ to, subject }, 'RESEND_API_KEY not set — email NOT sent');
      return false;
    }
    logger.info({ to, subject, html }, 'email (console driver)');
    return true;
  }
  await resend.emails.send({ from: env.EMAIL_FROM, to, subject, html });
  return true;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function invitationEmail(brandName: string, link: string): { subject: string; html: string } {
  const safeBrandName = escapeHtml(brandName);
  return {
    subject: `You're invited to join ${safeBrandName}`,
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <h2>${safeBrandName}</h2>
      <p>You've been invited to the ${safeBrandName} workspace.</p>
      <p><a href="${link}" style="display:inline-block;background:#1d4ed8;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none">Accept invitation</a></p>
      <p style="color:#64748b;font-size:13px">This link expires in 7 days. If you weren't expecting it, you can ignore this email.</p>
    </div>`,
  };
}

export function invitationAcceptedEmail(displayName: string, profileLink: string): { subject: string; html: string } {
  const safeName = escapeHtml(displayName);
  return {
    // Subject is a plain-text header, not HTML — use the raw name.
    subject: `${displayName} accepted your invitation`,
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <p><strong>${safeName}</strong> accepted your invitation and joined the workspace.</p>
      <p><a href="${profileLink}">View their profile</a></p>
    </div>`,
  };
}

export function importantPostEmail(title: string, link: string): { subject: string; html: string } {
  const safeTitle = escapeHtml(title);
  return {
    subject: `Important announcement: ${title}`,
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <p>An important announcement was posted to your workspace:</p>
      <p><strong>${safeTitle}</strong></p>
      <p><a href="${link}">Read it on the message board</a></p>
    </div>`,
  };
}

export function mandatoryEventEmail(title: string, startAtIso: string, link: string): { subject: string; html: string } {
  const safeTitle = escapeHtml(title);
  return {
    subject: `Mandatory event: ${title}`,
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <p>A mandatory event was scheduled: <strong>${safeTitle}</strong></p>
      <p>Starts at ${startAtIso} (shown in your local time on the calendar).</p>
      <p><a href="${link}">View it on the calendar</a></p>
    </div>`,
  };
}

export function eventReminderEmail(title: string, startAtIso: string, link: string): { subject: string; html: string } {
  const safeTitle = escapeHtml(title);
  return {
    subject: `Reminder: ${title}`,
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <p>Upcoming event: <strong>${safeTitle}</strong></p>
      <p>Starts at ${startAtIso} (shown in your local time on the calendar).</p>
      <p><a href="${link}">View it on the calendar</a></p>
    </div>`,
  };
}

export function taskAssignedEmail(title: string, dueAtIso: string | null, link: string): { subject: string; html: string } {
  const safeTitle = escapeHtml(title);
  return {
    subject: `New task: ${title}`,
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <p>You've been assigned a task: <strong>${safeTitle}</strong></p>
      ${dueAtIso ? `<p>Due: ${dueAtIso}</p>` : ''}
      <p><a href="${link}">Open the task</a></p>
    </div>`,
  };
}

export function taskDueEmail(kind: 'due-soon' | 'overdue', title: string, link: string): { subject: string; html: string } {
  const safeTitle = escapeHtml(title);
  const lead = kind === 'due-soon' ? 'is due within 24 hours' : 'is overdue';
  return {
    subject: kind === 'due-soon' ? `Task due soon: ${title}` : `Task overdue: ${title}`,
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <p>Your task <strong>${safeTitle}</strong> ${lead}.</p>
      <p><a href="${link}">Open the task</a></p>
    </div>`,
  };
}
