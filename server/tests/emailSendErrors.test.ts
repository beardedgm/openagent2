// The Resend SDK reports API failures in its RESOLVED value ({ data, error })
// instead of throwing — sendEmail must check it or failed sends report success.
import { describe, expect, it, vi } from 'vitest';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

process.env.RESEND_API_KEY = 'test-key-so-the-resend-branch-activates';
const { sendEmail } = await import('../src/services/emailService.js');

describe('sendEmail resend-branch error handling', () => {
  it('returns false when the Resend API resolves with an error', async () => {
    sendMock.mockResolvedValueOnce({ data: null, error: { message: 'Domain is not verified', name: 'validation_error' } });
    expect(await sendEmail('x@example.com', 'subj', '<p>hi</p>')).toBe(false);
  });

  it('returns true when the Resend API resolves with data', async () => {
    sendMock.mockResolvedValueOnce({ data: { id: 'email_123' }, error: null });
    expect(await sendEmail('x@example.com', 'subj', '<p>hi</p>')).toBe(true);
  });
});
