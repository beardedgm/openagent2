import { describe, expect, it } from 'vitest';
import { htmlToText, sanitizePostHtml } from '../src/utils/sanitizeHtml.js';

describe('sanitizePostHtml', () => {
  it('keeps the TipTap formatting set', () => {
    const html =
      '<h2>T</h2><p><strong>b</strong> <em>i</em></p><ul><li>a</li></ul><ol><li>1</li></ol><blockquote><p>q</p></blockquote>';
    expect(sanitizePostHtml(html)).toBe(html);
  });

  it('strips script tags, event handlers, and style attributes', () => {
    expect(sanitizePostHtml('<p onclick="x()">a</p><script>evil()</script>')).toBe('<p>a</p>');
    expect(sanitizePostHtml('<p style="position:fixed">a</p>')).toBe('<p>a</p>');
  });

  it('blocks javascript: and protocol-relative URLs, keeps https and relative', () => {
    expect(sanitizePostHtml('<a href="javascript:alert(1)">x</a>')).toBe(
      '<a rel="noopener noreferrer" target="_blank">x</a>',
    );
    expect(sanitizePostHtml('<img src="//evil.com/x.png" />')).toBe('<img />');
    expect(sanitizePostHtml('<img src="/files/posts/a.png" alt="a" />')).toBe('<img src="/files/posts/a.png" alt="a" />');
    expect(sanitizePostHtml('<a href="https://ok.com">x</a>')).toBe(
      '<a href="https://ok.com" rel="noopener noreferrer" target="_blank">x</a>',
    );
  });

  it('forces rel/target on links', () => {
    expect(sanitizePostHtml('<a href="https://a.com" target="_top" rel="opener">x</a>')).toBe(
      '<a href="https://a.com" target="_blank" rel="noopener noreferrer">x</a>',
    );
  });
});

describe('htmlToText', () => {
  it('flattens markup to searchable text', () => {
    expect(htmlToText('<h2>Hello</h2><p><strong>world</strong> &amp; friends</p>')).toBe('Hello world &amp; friends');
  });
});
