export function applyAccentColor(hex: string): void {
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
    document.documentElement.style.setProperty('--color-accent', hex);
  }
}
