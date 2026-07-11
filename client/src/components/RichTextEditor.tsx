import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  Bold,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useRef } from 'react';
import { api } from '../api/client';

function ToolbarButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      style={{
        width: 44,
        height: 44,
        display: 'grid',
        placeItems: 'center',
        background: active ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)' : 'transparent',
        border: 'none',
        borderRadius: 'var(--radius-sm)',
        color: active ? 'var(--color-accent)' : 'var(--color-text)',
      }}
    >
      {children}
    </button>
  );
}

function promptForLink(editor: Editor) {
  const url = window.prompt('Link URL (https://…)', (editor.getAttributes('link').href as string) ?? '');
  if (url === null) return;
  if (url === '') editor.chain().focus().unsetLink().run();
  else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
}

export function RichTextEditor({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const editor = useEditor({
    extensions: [
      // Constrained to the server sanitizer's allowlist (see server/src/utils/sanitizeHtml.ts):
      // no h1/h4-h6, no code/code blocks, no horizontal rules — the server would strip them on save.
      StarterKit.configure({
        heading: { levels: [2, 3] },
        code: false,
        codeBlock: false,
        horizontalRule: false,
      }),
      Link.configure({ openOnClick: false }),
      Image,
    ],
    content: value,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });
  if (!editor) return null;

  const uploadImage = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post<{ url: string }>('/uploads/post-image', formData);
    editor.chain().focus().setImage({ src: data.url }).run();
  };

  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
      <div
        role="toolbar"
        aria-label="Formatting"
        style={{ display: 'flex', gap: 2, padding: 2, borderBottom: '1px solid var(--color-border)' }}
      >
        <ToolbarButton label="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold size={18} />
        </ToolbarButton>
        <ToolbarButton label="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic size={18} />
        </ToolbarButton>
        <ToolbarButton label="Bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List size={18} />
        </ToolbarButton>
        <ToolbarButton label="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered size={18} />
        </ToolbarButton>
        <ToolbarButton label="Link" active={editor.isActive('link')} onClick={() => promptForLink(editor)}>
          <LinkIcon size={18} />
        </ToolbarButton>
        <ToolbarButton label="Image" onClick={() => fileRef.current?.click()}>
          <ImageIcon size={18} />
        </ToolbarButton>
      </div>
      <EditorContent editor={editor} />
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          if (file) void uploadImage(file);
          e.currentTarget.value = '';
        }}
      />
      <style>{`
        .ProseMirror { min-height: 180px; padding: var(--space-3); outline: none; }
        .ProseMirror:focus-visible { box-shadow: inset 0 0 0 2px var(--color-accent); }
        .ProseMirror img { max-width: 100%; }
      `}</style>
    </div>
  );
}
