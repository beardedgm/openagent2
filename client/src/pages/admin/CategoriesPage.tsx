import { isAxiosError } from 'axios';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useCategories, useCategoryMutations } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Spinner } from '../../components/ui/Spinner';

export function CategoriesPage() {
  const { data: categories, isLoading } = useCategories();
  const { create, rename, remove } = useCategoryMutations();
  const [newName, setNewName] = useState('');
  const [subNames, setSubNames] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState('');
  if (isLoading) return <Spinner />;
  const topLevel = (categories ?? []).filter((c) => !c.parentId);
  const childrenOf = (id: string) => (categories ?? []).filter((c) => c.parentId === id);
  const fail = (err: unknown) =>
    setError(isAxiosError(err) ? (err.response?.data?.error ?? 'Something went wrong') : 'Something went wrong');

  const nameRow = (c: { id: string; name: string }, label: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 44 }}>
      {editing?.id === c.id ? (
        <>
          <input
            aria-label={`Rename ${c.name}`}
            value={editing.name}
            onChange={(e) => setEditing({ id: c.id, name: e.target.value })}
            style={{ flex: 1 }}
          />
          <Button
            variant="secondary"
            aria-label={`Save name for ${c.name}`}
            onClick={() => rename.mutate({ id: c.id, name: editing.name }, { onSuccess: () => setEditing(null), onError: fail })}
          >
            <Check size={14} />
          </Button>
          <Button variant="secondary" aria-label="Cancel rename" onClick={() => setEditing(null)}><X size={14} /></Button>
        </>
      ) : (
        <>
          <span style={{ flex: 1, fontSize: 14 }}>{label}</span>
          <button
            type="button"
            aria-label={`Rename ${c.name}`}
            onClick={() => { setError(''); setEditing({ id: c.id, name: c.name }); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', minWidth: 44, minHeight: 44, color: 'var(--color-text-muted)' }}
          >
            <Pencil size={15} />
          </button>
          <button
            type="button"
            aria-label={`Delete ${c.name}`}
            onClick={() => {
              if (window.confirm(`Delete the category "${c.name}"?`)) {
                setError('');
                remove.mutate(c.id, { onError: fail });
              }
            }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', minWidth: 44, minHeight: 44, color: 'var(--color-danger)' }}
          >
            <Trash2 size={15} />
          </button>
        </>
      )}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: 640 }}>
      <h1 style={{ fontSize: 24 }}>Resource categories</h1>
      {error && <p role="alert" style={{ color: 'var(--color-danger)' }}>{error}</p>}

      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            setError('');
            create.mutate({ name: newName.trim(), parentId: null }, { onSuccess: () => setNewName(''), onError: fail });
          }}
          style={{ display: 'flex', gap: 'var(--space-2)' }}
        >
          <input aria-label="New category name" placeholder="New category…" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ flex: 1, minHeight: 44 }} />
          <Button type="submit" aria-label="Add category"><Plus size={14} /> Add</Button>
        </form>
      </Card>

      {topLevel.map((cat) => (
        <Card key={cat.id}>
          {nameRow(cat, cat.name)}
          <div style={{ paddingLeft: 'var(--space-4)', borderLeft: '2px solid var(--color-border)', marginLeft: 'var(--space-2)' }}>
            {childrenOf(cat.id).map((sub) => (
              <div key={sub.id}>{nameRow(sub, sub.name)}</div>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const name = (subNames[cat.id] ?? '').trim();
                if (!name) return;
                setError('');
                create.mutate({ name, parentId: cat.id }, { onSuccess: () => setSubNames((s) => ({ ...s, [cat.id]: '' })), onError: fail });
              }}
              style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}
            >
              <input
                aria-label={`Add subcategory to ${cat.name}`}
                placeholder="New subcategory…"
                value={subNames[cat.id] ?? ''}
                onChange={(e) => setSubNames((s) => ({ ...s, [cat.id]: e.target.value }))}
                style={{ flex: 1, minHeight: 44 }}
              />
              <Button type="submit" variant="secondary" aria-label={`Add subcategory under ${cat.name}`}><Plus size={14} /></Button>
            </form>
          </div>
        </Card>
      ))}
      {topLevel.length === 0 && <p style={{ color: 'var(--color-text-muted)' }}>No categories yet — resources need at least one.</p>}
    </div>
  );
}
