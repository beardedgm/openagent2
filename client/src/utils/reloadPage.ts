/** Full page reload behind a wrapper so tests can stub it (jsdom's location.reload is non-configurable). */
export function reloadPage(): void {
  window.location.reload();
}
