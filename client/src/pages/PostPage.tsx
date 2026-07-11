import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Pin, PinOff, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useComments, useMe, usePost } from '../api/hooks';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';

function mutationErrorMessage(isError: boolean, error: unknown, fallback: string): string | undefined {
  if (!isError) return undefined;
  if (isAxiosError(error)) return (error.response?.data as { error?: string })?.error ?? fallback;
  return fallback;
}

export function PostPage() {
  const { id } = useParams();
  const { data: post, isLoading, error } = usePost(id);
  const { data: comments } = useComments(id);
  const { data: me } = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [commentBody, setCommentBody] = useState('');

  const isAdmin = me?.role === 'broker' || me?.role === 'officeAdmin';

  const addComment = useMutation({
    mutationFn: (body: string) => api.post(`/posts/${id}/comments`, { body }),
    onSuccess: async () => {
      setCommentBody('');
      await qc.invalidateQueries({ queryKey: ['posts', id, 'comments'] });
    },
  });
  const deleteComment = useMutation({
    mutationFn: (commentId: string) => api.delete(`/posts/${id}/comments/${commentId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['posts', id, 'comments'] }),
  });
  const togglePin = useMutation({
    mutationFn: () => (post?.pinnedAt ? api.delete(`/posts/${id}/pin`) : api.post(`/posts/${id}/pin`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['posts'] }),
  });
  const deletePost = useMutation({
    mutationFn: () => api.delete(`/posts/${id}`),
    onSuccess: () => {
      // Navigate first — invalidating while this page is still mounted refetches the deleted post into a 404.
      navigate('/board');
      void qc.invalidateQueries({ queryKey: ['posts'] });
    },
  });

  const pinError = mutationErrorMessage(togglePin.isError, togglePin.error, 'Could not pin');
  const deleteError = mutationErrorMessage(deletePost.isError, deletePost.error, 'Could not delete the post');
  const commentError =
    mutationErrorMessage(addComment.isError, addComment.error, 'Could not save the comment') ??
    mutationErrorMessage(deleteComment.isError, deleteComment.error, 'Could not delete the comment');

  if (isLoading) return <Spinner label="Loading post" />;
  if (!post) {
    if (isAxiosError(error) && error.response?.status === 404) {
      return (
        <Card>
          <h2 style={{ fontSize: 18 }}>Post not found</h2>
        </Card>
      );
    }
    return null;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: 720 }}>
      <Card>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 22, flex: 1 }}>{post.title}</h1>
          {post.pinnedAt && <Badge tone="accent">Pinned</Badge>}
          {post.important && <Badge tone="danger">Important</Badge>}
        </div>
        <div style={{ marginTop: 'var(--space-1)', fontSize: 13, color: 'var(--color-text-muted)' }}>
          {post.author?.displayName ?? 'Unknown'} · {new Date(post.publishAt).toLocaleString()}
        </div>
        {/* Server-sanitized at write time (sanitize-html allowlist) — the only reason this is safe. */}
        <div style={{ marginTop: 'var(--space-4)' }} dangerouslySetInnerHTML={{ __html: post.bodyHtml }} />
        {isAdmin && (
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)', flexWrap: 'wrap' }}>
            <Link
              to={`/board/${post.id}/edit`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: 44,
                padding: '0 var(--space-4)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface)',
                color: 'var(--color-text)',
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              Edit
            </Link>
            <Button variant="secondary" onClick={() => togglePin.mutate()} disabled={togglePin.isPending}>
              {post.pinnedAt ? <PinOff size={16} /> : <Pin size={16} />}
              <span style={{ marginLeft: 6 }}>{post.pinnedAt ? 'Unpin' : 'Pin'}</span>
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (window.confirm('Delete this post and its comments?')) deletePost.mutate();
              }}
              disabled={deletePost.isPending}
            >
              Delete
            </Button>
          </div>
        )}
        {pinError && (
          <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 13, marginTop: 'var(--space-2)' }}>
            {pinError}
          </p>
        )}
        {deleteError && (
          <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 13, marginTop: 'var(--space-2)' }}>
            {deleteError}
          </p>
        )}
      </Card>

      <Card>
        <h2 style={{ fontSize: 18, marginBottom: 'var(--space-3)' }}>Comments</h2>
        {comments?.length === 0 && (
          <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>
            {post.commentsEnabled ? 'No comments yet.' : 'Comments are disabled on this post.'}
          </p>
        )}
        {comments?.map((c) => (
          <div
            key={c.id}
            style={{
              display: 'flex',
              gap: 'var(--space-2)',
              alignItems: 'baseline',
              padding: 'var(--space-2) 0',
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{c.author?.displayName ?? 'Unknown'}</span>
              <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>
                {new Date(c.createdAt).toLocaleString()}
              </span>
              <p style={{ fontSize: 14, marginTop: 2 }}>{c.body}</p>
            </div>
            {(isAdmin || c.author?.id === me?.id) && (
              <button
                aria-label={`Delete comment by ${c.author?.displayName ?? 'unknown'}`}
                onClick={() => {
                  if (window.confirm('Delete this comment?')) deleteComment.mutate(c.id);
                }}
                style={{
                  width: 44,
                  height: 44,
                  display: 'grid',
                  placeItems: 'center',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--color-danger)',
                }}
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        ))}
        {post.commentsEnabled && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (commentBody.trim()) addComment.mutate(commentBody.trim());
            }}
            style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}
          >
            <input
              aria-label="Add a comment"
              placeholder="Add a comment…"
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              maxLength={2000}
              style={{
                flex: 1,
                minHeight: 44,
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                padding: '0 var(--space-3)',
                background: 'var(--color-surface)',
              }}
            />
            <Button type="submit" disabled={addComment.isPending || !commentBody.trim()}>
              Comment
            </Button>
          </form>
        )}
        {commentError && (
          <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 13, marginTop: 'var(--space-2)' }}>
            {commentError}
          </p>
        )}
      </Card>
    </div>
  );
}
