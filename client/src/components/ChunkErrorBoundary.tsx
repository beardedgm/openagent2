import { Component, type ReactNode } from 'react';
import { reloadPage } from '../utils/reloadPage';
import { Button } from './ui/Button';
import { Card } from './ui/Card';

// Render redeploys change hashed asset filenames, so a stale session's next lazy-route
// navigation can fail to fetch its chunk (the old file is gone). On the first such failure
// per session we reload once to pick up the new asset manifest; any other error — or a
// second chunk failure — renders a small fallback instead of a white screen.
// Message patterns cover Chrome ("Failed to fetch dynamically imported module"),
// Firefox ("error loading dynamically imported module"), and Safari
// ("Importing a module script failed").
const CHUNK_ERROR_RE =
  /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i;
const RELOAD_FLAG = 'chunk-reload-once';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ChunkErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    if (CHUNK_ERROR_RE.test(error.message) && !sessionStorage.getItem(RELOAD_FLAG)) {
      sessionStorage.setItem(RELOAD_FLAG, '1');
      reloadPage();
    }
  }

  render() {
    if (this.state.error) {
      return (
        <Card
          role="alert"
          style={{ margin: 'var(--space-6) auto', maxWidth: 420, textAlign: 'center' }}
        >
          <p style={{ margin: '0 0 var(--space-4)' }}>
            Something went wrong — refresh to continue.
          </p>
          <Button onClick={reloadPage} style={{ minHeight: 44 }}>
            Reload
          </Button>
        </Card>
      );
    }
    return this.props.children;
  }
}
