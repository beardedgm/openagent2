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

  it('strips data: URIs on links and images', () => {
    expect(sanitizePostHtml('<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>')).toBe(
      '<a rel="noopener noreferrer" target="_blank">x</a>',
    );
    expect(sanitizePostHtml('<img src="data:image/svg+xml,<svg onload=alert(1)>" />')).toBe('<img />');
  });

  it('strips entity-encoded and whitespace-obfuscated javascript: schemes', () => {
    expect(sanitizePostHtml('<a href="java&#115;cript:alert(1)">x</a>')).toBe(
      '<a rel="noopener noreferrer" target="_blank">x</a>',
    );
    expect(sanitizePostHtml('<a href="jav\tascript:alert(1)">x</a>')).toBe(
      '<a rel="noopener noreferrer" target="_blank">x</a>',
    );
  });

  it('strips onerror from img while keeping src', () => {
    expect(sanitizePostHtml('<img src="x" onerror="alert(1)">')).toBe('<img src="x" />');
  });

  it('strips srcset from img', () => {
    expect(sanitizePostHtml('<img src="/a.png" srcset="//evil.com/x.png 2x">')).toBe('<img src="/a.png" />');
  });

  it('strips vbscript: hrefs', () => {
    expect(sanitizePostHtml('<a href="vbscript:msgbox(1)">x</a>')).toBe(
      '<a rel="noopener noreferrer" target="_blank">x</a>',
    );
  });

  it('leaves no executable content from mXSS foreign-content payloads', () => {
    expect(sanitizePostHtml('<svg><style><img src=x onerror=alert(1)></style></svg>')).toBe('');
    expect(sanitizePostHtml('<math><mtext></mtext></math>')).toBe('');
  });

  it('strips backslash protocol-relative img src', () => {
    expect(sanitizePostHtml('<img src="/\\evil.com/x.png">')).toBe('<img />');
    expect(sanitizePostHtml('<img src="/\\\\evil.com/x.png">')).toBe('<img />');
  });
});

describe('htmlToText', () => {
  it('flattens markup to searchable text', () => {
    expect(htmlToText('<h2>Hello</h2><p><strong>world</strong> &amp; friends</p>')).toBe('Hello world & friends');
  });

  it('decodes entities to literal characters, ampersand last', () => {
    expect(htmlToText('<p>commission &amp; fees</p>')).toBe('commission & fees');
    expect(htmlToText('<p>5 &lt; 10 &amp; 10 &gt; 5</p>')).toBe('5 < 10 & 10 > 5');
    // Double-escaped input must not double-decode into a real tag delimiter.
    expect(htmlToText('<p>&amp;lt;</p>')).toBe('&lt;');
  });
});
