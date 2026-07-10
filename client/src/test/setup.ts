import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest runs without `globals: true`, so Testing Library's automatic cleanup never
// registers itself — without this, rendered trees leak across tests within a file.
afterEach(cleanup);

// jsdom does not implement the native <dialog> element's imperative methods (used by
// components/ui/Modal.tsx), so any test that renders an open or closing Modal throws
// "showModal/close is not a function" without this minimal polyfill. It mirrors the
// spec's observable behavior: close() on an already-closed dialog is a no-op, and the
// close event fires from a queued task, not synchronously inside close().
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
}
if (!HTMLDialogElement.prototype.close) {
  HTMLDialogElement.prototype.close = function () {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    setTimeout(() => this.dispatchEvent(new Event('close')), 0);
  };
}
