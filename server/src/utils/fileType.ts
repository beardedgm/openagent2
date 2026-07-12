export const FILE_TYPES = ['pdf', 'image', 'word', 'excel', 'powerpoint', 'video', 'audio', 'archive', 'text', 'other', 'link'] as const;
export type FileType = (typeof FILE_TYPES)[number];

const BY_CONTENT_TYPE: [RegExp, FileType][] = [
  [/^application\/pdf$/, 'pdf'],
  [/^image\//, 'image'],
  [/wordprocessingml|msword/, 'word'],
  [/spreadsheetml|ms-excel/, 'excel'],
  [/presentationml|ms-powerpoint/, 'powerpoint'],
  [/^video\//, 'video'],
  [/^audio\//, 'audio'],
  [/zip|x-tar|x-7z|x-rar/, 'archive'],
  [/^text\//, 'text'],
];

const BY_EXTENSION: Record<string, FileType> = {
  pdf: 'pdf', png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image',
  doc: 'word', docx: 'word', xls: 'excel', xlsx: 'excel', csv: 'excel',
  ppt: 'powerpoint', pptx: 'powerpoint', mp4: 'video', mov: 'video',
  mp3: 'audio', wav: 'audio', zip: 'archive', rar: 'archive', '7z': 'archive',
  txt: 'text', md: 'text',
};

/** Filterable label for a stored file: content type first, extension fallback, then 'other'. */
export function fileTypeOf(contentType: string, fileName: string): FileType {
  for (const [re, type] of BY_CONTENT_TYPE) if (re.test(contentType)) return type;
  const ext = fileName.includes('.') ? (fileName.split('.').pop() ?? '').toLowerCase() : '';
  return BY_EXTENSION[ext] ?? 'other';
}
