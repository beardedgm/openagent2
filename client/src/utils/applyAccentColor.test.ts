import { describe, expect, it } from 'vitest';
import { applyAccentColor } from './applyAccentColor';

describe('applyAccentColor', () => {
  it('sets the accent variable for valid hex', () => {
    applyAccentColor('#0f766e');
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('#0f766e');
  });

  it('ignores invalid values', () => {
    applyAccentColor('#0f766e');
    applyAccentColor('javascript:alert(1)');
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('#0f766e');
  });
});
