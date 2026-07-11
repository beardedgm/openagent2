import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RichTextEditor } from './RichTextEditor';

vi.mock('../api/client', () => ({ api: { post: vi.fn() } }));

describe('RichTextEditor', () => {
  it('renders a formatting toolbar', async () => {
    render(<RichTextEditor value="<p>hello</p>" onChange={() => {}} />);
    expect(await screen.findByRole('toolbar', { name: /formatting/i })).toBeInTheDocument();
    for (const name of [/bold/i, /italic/i, /bullet list/i, /numbered list/i, /link/i, /image/i]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });
});
