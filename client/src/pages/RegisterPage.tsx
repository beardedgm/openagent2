import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { usePublicSettings } from '../api/hooks';
import { TurnstileWidget } from '../components/TurnstileWidget';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Field } from '../components/ui/Field';
import { applyAccentColor } from '../utils/applyAccentColor';

export function RegisterPage() {
  const { data: branding } = usePublicSettings();
  useEffect(() => {
    if (branding?.primaryColor) applyAccentColor(branding.primaryColor);
  }, [branding?.primaryColor]);
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmError, setConfirmError] = useState<string>();
  const [turnstileToken, setTurnstileToken] = useState<string>();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const register = useMutation({
    mutationFn: () => api.post('/auth/register', { token, password, displayName, turnstileToken }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['me'] });
      navigate('/', { replace: true });
    },
  });

  const registerStatus = register.isError && isAxiosError(register.error) ? register.error.response?.status : undefined;

  const errorMessage =
    register.isError && isAxiosError(register.error)
      ? ((register.error.response?.data as { error?: string })?.error ?? 'Registration failed')
      : undefined;

  // A 400 means the token itself is invalid/expired/used — the link is permanently dead, so an
  // interactive form is misleading. A 409 (account already exists) is left as an inline error
  // since the form/token are otherwise fine.
  if (!token || registerStatus === 400) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 'var(--space-4)' }}>
        <Card style={{ width: 'min(400px, 100%)' }}>
          <h1 style={{ fontSize: 22 }}>Invalid invitation link</h1>
          <p style={{ color: 'var(--color-text-muted)' }}>
            This registration link is missing or invalid. Please contact your administrator for a new
            invitation.
          </p>
        </Card>
      </div>
    );
  }

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
        <h1 style={{ fontSize: 22 }}>Create your account</h1>
        {errorMessage && (
          <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 14, marginTop: 'var(--space-2)' }}>
            {errorMessage}
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (password !== confirmPassword) {
              setConfirmError('Passwords do not match');
              return;
            }
            setConfirmError(undefined);
            register.mutate();
          }}
        >
          <Field
            label="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            autoFocus
          />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (confirmError) setConfirmError(undefined);
            }}
            required
            minLength={8}
            hint="At least 8 characters."
          />
          <Field
            label="Confirm password"
            type="password"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              if (confirmError) setConfirmError(undefined);
            }}
            required
            error={confirmError}
          />
          <TurnstileWidget onToken={setTurnstileToken} />
          <Button type="submit" disabled={register.isPending} style={{ width: '100%' }}>
            {register.isPending ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
