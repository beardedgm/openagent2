import sanitize from 'sanitize-html';

// Allowlist for the client TipTap editor output (StarterKit constrained to these tags + Link + Image
// — see RichTextEditor); anything else is stripped.
const OPTIONS: sanitize.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'ul', 'ol', 'li', 'h2', 'h3', 'blockquote', 'img'],
  allowedAttributes: { a: ['href', 'rel', 'target'], img: ['src', 'alt'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  transformTags: {
    a: sanitize.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
  },
};

export function sanitizePostHtml(html: string): string {
  return sanitize(html, OPTIONS);
}

export function htmlToText(html: string): string {
  // Insert a space at bare tag boundaries so adjacent block elements (e.g. </h2><p>)
  // don't have their text run together once tags are stripped below.
  const spaced = html.replace(/></g, '> <');
  return (
    sanitize(spaced, { allowedTags: [], allowedAttributes: {} })
      .replace(/\s+/g, ' ')
      .trim()
      // Decode entities so search/excerpts see literal characters. Safe only because
      // bodyText is never rendered as HTML (it feeds keyword search + plain-text excerpts).
      // Order matters: decode &amp; LAST so "&amp;lt;" becomes "&lt;", not "<".
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
  );
}
