import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest runs without `globals: true`, so Testing Library's automatic cleanup never
// registers itself — without this, rendered trees leak across tests within a file.
afterEach(cleanup);
