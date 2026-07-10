import { describe, expect, it } from 'vitest';
import { invitationEmail } from '../src/services/emailService.js';

describe('email templates', () => {
  it('builds an invitation email containing the link and brand', () => {
    const { subject, html } = invitationEmail('Acme Realty', 'http://localhost:5173/register?token=abc');
    expect(subject).toContain('Acme Realty');
    expect(html).toContain('http://localhost:5173/register?token=abc');
  });
});
