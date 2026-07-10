import sanitize from 'sanitize-html';

// Mirrors exactly what the client TipTap editor can produce (StarterKit + Link + Image).
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
  return sanitize(spaced, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();
}
