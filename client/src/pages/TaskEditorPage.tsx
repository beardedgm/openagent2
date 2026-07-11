import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useSettings, useUsers } from '../api/hooks';
import type { EventRecurrence, TaskInfo, TaskPriority } from '../api/types';
import { RichTextEditor } from '../components/RichTextEditor';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Field } from '../components/ui/Field';

type AudienceType = 'all' | 'office' | 'users';

const selectStyle = {
  minHeight: 44,
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: '0 var(--space-3)',
  background: 'var(--color-surface)',
};

export function TaskEditorPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const { data: users } = useUsers();
  const activeUsers = (users ?? []).filter((u) => u.status === 'active');

  const [title, setTitle] = useState('');
  const [descriptionHtml, setDescriptionHtml] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('Medium');
  const [dueAt, setDueAt] = useState('');
  const [recurrence, setRecurrence] = useState<EventRecurrence>('none');
  const [audienceType, setAudienceType] = useState<AudienceType>('all');
  const [officeId, setOfficeId] = useState('');
  const [userIds, setUserIds] = useState<string[]>([]);

  function toggleUser(id: string) {
    setUserIds((prev) => (prev.includes(id) ? prev.filter((u) => u !== id) : [...prev, id]));
  }

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        title,
        descriptionHtml,
        priority,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        recurrence,
        audience: {
          type: audienceType,
          officeId: audienceType === 'office' ? officeId : null,
          userIds: audienceType === 'users' ? userIds : [],
        },
      };
      const res = await api.post<{ task: TaskInfo }>('/tasks', body);
      return res.data.task;
    },
    onSuccess: async (task) => {
      await qc.invalidateQueries({ queryKey: ['tasks'] });
      navigate(`/tasks/${task.id}`);
    },
  });

  const errorMessage =
    save.isError && isAxiosError(save.error)
      ? ((save.error.response?.data as { error?: string })?.error ?? 'Could not save the task')
      : undefined;

  const submitDisabled = save.isPending || (audienceType === 'users' && userIds.length === 0);

  return (
    <Card style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, marginBottom: 'var(--space-4)' }}>New task</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />

        <div style={{ display: 'grid', gap: 'var(--space-1)', marginBottom: 'var(--space-4)' }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Description</span>
          <RichTextEditor value={descriptionHtml} onChange={setDescriptionHtml} />
        </div>

        <div style={{ display: 'grid', gap: 'var(--space-1)', marginBottom: 'var(--space-4)' }}>
          <label htmlFor="task-priority" style={{ fontWeight: 600, fontSize: 14 }}>
            Priority
          </label>
          <select
            id="task-priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as TaskPriority)}
            style={selectStyle}
          >
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
        </div>

        <div style={{ display: 'grid', gap: 'var(--space-1)', marginBottom: 'var(--space-4)' }}>
          <label htmlFor="task-due-at" style={{ fontWeight: 600, fontSize: 14 }}>
            Due date (optional)
          </label>
          <input
            id="task-due-at"
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            style={selectStyle}
          />
        </div>

        <div style={{ display: 'grid', gap: 'var(--space-1)', marginBottom: 'var(--space-4)' }}>
          <label htmlFor="task-recurrence" style={{ fontWeight: 600, fontSize: 14 }}>
            Recurrence
          </label>
          <select
            id="task-recurrence"
            value={recurrence}
            onChange={(e) => setRecurrence(e.target.value as EventRecurrence)}
            style={selectStyle}
          >
            <option value="none">None</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>

        <div style={{ display: 'grid', gap: 'var(--space-1)', marginBottom: 'var(--space-3)' }}>
          <label htmlFor="task-audience" style={{ fontWeight: 600, fontSize: 14 }}>
            Audience
          </label>
          <select
            id="task-audience"
            value={audienceType}
            onChange={(e) => {
              setAudienceType(e.target.value as AudienceType);
              setOfficeId('');
              setUserIds([]);
            }}
            style={selectStyle}
          >
            <option value="all">Everyone</option>
            <option value="office">One office</option>
            <option value="users">Specific users</option>
          </select>
        </div>

        {audienceType === 'office' && (
          <div style={{ display: 'grid', gap: 'var(--space-1)', marginBottom: 'var(--space-4)' }}>
            <label htmlFor="task-office" style={{ fontWeight: 600, fontSize: 14 }}>
              Office
            </label>
            <select
              id="task-office"
              value={officeId}
              onChange={(e) => setOfficeId(e.target.value)}
              style={selectStyle}
            >
              <option value="">Select an office</option>
              {settings?.officeLocations.map((o) => (
                <option key={o._id} value={o._id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {audienceType === 'users' && (
          <div style={{ display: 'grid', gap: 'var(--space-1)', marginBottom: 'var(--space-4)' }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>Assign to</span>
            {activeUsers.map((u) => (
              <label
                key={u.id}
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 44, fontSize: 14 }}
              >
                <input
                  type="checkbox"
                  checked={userIds.includes(u.id)}
                  onChange={() => toggleUser(u.id)}
                  style={{ width: 18, height: 18 }}
                />
                {u.displayName}
              </label>
            ))}
          </div>
        )}

        {errorMessage && (
          <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 'var(--space-3)' }}>
            {errorMessage}
          </p>
        )}
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Button type="submit" disabled={submitDisabled}>
            {save.isPending ? 'Saving…' : 'Create task'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
