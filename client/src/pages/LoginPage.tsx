import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { usePublicSettings } from '../api/hooks';
import { TurnstileWidget } from '../components/TurnstileWidget';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Field } from '../components/ui/Field';

export function LoginPage() {
  const { data: branding } = usePublicSettings();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [turnstileToken, setTurnstileToken] = useState<string>();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const login = useMutation({
    mutationFn: () => api.post('/auth/login', { email, password, turnstileToken }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['me'] });
      navigate('/', { replace: true });
    },
  });

  const errorMessage =
    login.isError && isAxiosError(login.error)
      ? ((login.error.response?.data as { error?: string })?.error ?? 'Login failed')
      : undefined;

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 'var(--space-4)' }}>
      <Card style={{ width: 'min(400px, 100%)' }}>
        {branding?.logoUrl && (
          <img
            src={branding.logoUrl}
            alt={`${branding.brandName} logo`}
            style={{ maxHeight: 48, marginBottom: 12 }}
          />
        )}
        <h1 style={{ fontSize: 22 }}>{branding?.brandName ?? 'Workspace'}</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            login.mutate();
          }}
        >
          <Field
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            error={errorMessage}
          />
          <TurnstileWidget onToken={setTurnstileToken} />
          <Button type="submit" disabled={login.isPending} style={{ width: '100%' }}>
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
