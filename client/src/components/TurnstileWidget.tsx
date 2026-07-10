import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, opts: Record<string, unknown>) => void };
  }
}

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

export function TurnstileWidget({ onToken }: { onToken: (token: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!SITE_KEY || !ref.current) return;
    const render = () => window.turnstile?.render(ref.current!, { sitekey: SITE_KEY, callback: onToken });
    if (window.turnstile) {
      render();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    script.async = true;
    script.onload = render;
    document.head.appendChild(script);
  }, [onToken]);
  if (!SITE_KEY) return null;
  return <div ref={ref} />;
}
