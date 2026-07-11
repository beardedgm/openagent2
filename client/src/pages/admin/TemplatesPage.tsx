import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useState } from 'react';
import { api } from '../../api/client';
import { useTaskTemplates } from '../../api/hooks';
import type { TaskPriority, TaskTemplateInfo } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Spinner } from '../../components/ui/Spinner';

interface ItemRow {
  title: string;
  priority: TaskPriority;
  dueInDays: number | null;
}

function errorMessage(err: unknown, fallback: string): string {
  if (isAxiosError(err)) return (err.response?.data as { error?: string })?.error ?? fallback;
  return fallback;
}

const rowInputStyle = {
  minHeight: 44,
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: '0 var(--space-3)',
  background: 'var(--color-surface)',
};

function emptyItem(): ItemRow {
  return { title: '', priority: 'Medium', dueInDays: null };
}

export function TemplatesPage() {
  const qc = useQueryClient();
  const { data: templates, isLoading } = useTaskTemplates();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [items, setItems] = useState<ItemRow[]>([]);

  function resetForm() {
    setEditingId(null);
    setName('');
    setItems([]);
  }

  function edit(tpl: TaskTemplateInfo) {
    setEditingId(tpl.id);
    setName(tpl.name);
    setItems(tpl.items.map((i) => ({ title: i.title, priority: i.priority, dueInDays: i.dueInDays })));
  }

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name,
        items: items.map((i) => ({
          title: i.title,
          descriptionHtml: '',
          priority: i.priority,
          dueInDays: i.dueInDays,
        })),
      };
      return editingId ? api.patch(`/task-templates/${editingId}`, body) : api.post('/task-templates', body);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['task-templates'] });
      resetForm();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/task-templates/${id}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['task-templates'] });
    },
  });

  function updateItem(index: number, patch: Partial<ItemRow>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  const saveErrorMessage = save.isError ? errorMessage(save.error, 'Could not save template') : undefined;
  const deleteErrorMessage = remove.isError ? errorMessage(remove.error, 'Could not delete template') : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <h1 style={{ fontSize: 24 }}>Task templates</h1>

      {deleteErrorMessage && (
        <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 13 }}>
          {deleteErrorMessage}
        </p>
      )}

      {isLoading && <Spinner label="Loading templates" />}
      {templates?.map((tpl) => (
        <Card key={tpl.id}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <div style={{ flex: 1 }}>
              <strong>{tpl.name}</strong>
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                {tpl.items.length} item{tpl.items.length === 1 ? '' : 's'}
              </p>
            </div>
            <Button variant="secondary" onClick={() => edit(tpl)}>
              Edit
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (window.confirm(`Delete template "${tpl.name}"?`)) remove.mutate(tpl.id);
              }}
            >
              Delete
            </Button>
          </div>
        </Card>
      ))}

      <Card>
        <h2 style={{ fontSize: 18, marginBottom: 'var(--space-3)' }}>{editingId ? 'Edit template' : 'New template'}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
            {items.map((item, index) => (
              <div key={index} style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                <input
                  aria-label={`Item ${index + 1} title`}
                  value={item.title}
                  onChange={(e) => updateItem(index, { title: e.target.value })}
                  placeholder="Title"
                  style={{ ...rowInputStyle, flex: '2 1 200px' }}
                />
                <select
                  aria-label={`Item ${index + 1} priority`}
                  value={item.priority}
                  onChange={(e) => updateItem(index, { priority: e.target.value as TaskPriority })}
                  style={{ ...rowInputStyle, flex: '1 1 120px' }}
                >
                  <option value="High">High</option>
                  <option value="Medium">Medium</option>
                  <option value="Low">Low</option>
                </select>
                <input
                  aria-label={`Item ${index + 1} due in days`}
                  type="number"
                  min={0}
                  max={365}
                  value={item.dueInDays ?? ''}
                  onChange={(e) =>
                    updateItem(index, { dueInDays: e.target.value === '' ? null : Number(e.target.value) })
                  }
                  placeholder="Due in days"
                  style={{ ...rowInputStyle, flex: '1 1 120px' }}
                />
                <Button type="button" variant="secondary" onClick={() => removeItem(index)}>
                  Remove
                </Button>
              </div>
            ))}
          </div>

          <Button type="button" variant="secondary" onClick={() => setItems((prev) => [...prev, emptyItem()])}>
            Add item
          </Button>

          {saveErrorMessage && (
            <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 13, margin: 'var(--space-3) 0 0' }}>
              {saveErrorMessage}
            </p>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" variant="secondary" onClick={resetForm}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
