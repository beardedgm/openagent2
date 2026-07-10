import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';

vi.mock('../api/client', () => ({
  api: { get: vi.fn(async () => ({ data: { settings: { brandName: 'Acme Realty', logoUrl: '', primaryColor: '#1d4ed8' } } })), post: vi.fn() },
}));

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('LoginPage', () => {
  it('renders branding and the sign-in form', async () => {
    render(wrap(<LoginPage />));
    expect(await screen.findByText('Acme Realty')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });
});
