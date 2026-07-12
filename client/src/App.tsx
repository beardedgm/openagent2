import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { RequireAuth } from './components/RequireAuth';
import { Spinner } from './components/ui/Spinner';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';

const BoardPage = lazy(() => import('./pages/BoardPage').then((m) => ({ default: m.BoardPage })));
const CalendarPage = lazy(() => import('./pages/CalendarPage').then((m) => ({ default: m.CalendarPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const DirectoryPage = lazy(() => import('./pages/DirectoryPage').then((m) => ({ default: m.DirectoryPage })));
const EventDetailPage = lazy(() => import('./pages/EventDetailPage').then((m) => ({ default: m.EventDetailPage })));
const EventEditorPage = lazy(() => import('./pages/EventEditorPage').then((m) => ({ default: m.EventEditorPage })));
const FeedPage = lazy(() => import('./pages/FeedPage').then((m) => ({ default: m.FeedPage })));
const PostEditorPage = lazy(() => import('./pages/PostEditorPage').then((m) => ({ default: m.PostEditorPage })));
const PostPage = lazy(() => import('./pages/PostPage').then((m) => ({ default: m.PostPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage })));
const ResourceDetailPage = lazy(() =>
  import('./pages/ResourceDetailPage').then((m) => ({ default: m.ResourceDetailPage })),
);
const ResourceEditorPage = lazy(() =>
  import('./pages/ResourceEditorPage').then((m) => ({ default: m.ResourceEditorPage })),
);
const ResourceHubPage = lazy(() => import('./pages/ResourceHubPage').then((m) => ({ default: m.ResourceHubPage })));
const TaskDetailPage = lazy(() => import('./pages/TaskDetailPage').then((m) => ({ default: m.TaskDetailPage })));
const TaskEditorPage = lazy(() => import('./pages/TaskEditorPage').then((m) => ({ default: m.TaskEditorPage })));
const TasksPage = lazy(() => import('./pages/TasksPage').then((m) => ({ default: m.TasksPage })));
const BannersPage = lazy(() => import('./pages/admin/BannersPage').then((m) => ({ default: m.BannersPage })));
const CategoriesPage = lazy(() => import('./pages/admin/CategoriesPage').then((m) => ({ default: m.CategoriesPage })));
const SettingsPage = lazy(() => import('./pages/admin/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const TemplatesPage = lazy(() => import('./pages/admin/TemplatesPage').then((m) => ({ default: m.TemplatesPage })));
const UsersPage = lazy(() => import('./pages/admin/UsersPage').then((m) => ({ default: m.UsersPage })));

export function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route path="/" element={<DashboardPage />} />
          <Route path="/directory" element={<DirectoryPage />} />
          <Route path="/profile/:id" element={<ProfilePage />} />
          <Route path="/board" element={<BoardPage />} />
          <Route
            path="/board/new"
            element={
              <RequireAuth min="officeAdmin">
                <PostEditorPage />
              </RequireAuth>
            }
          />
          <Route path="/board/:id" element={<PostPage />} />
          <Route
            path="/board/:id/edit"
            element={
              <RequireAuth min="officeAdmin">
                <PostEditorPage />
              </RequireAuth>
            }
          />
          <Route path="/feed" element={<FeedPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/calendar/new" element={<EventEditorPage />} />
          <Route path="/calendar/:id" element={<EventDetailPage />} />
          <Route path="/calendar/:id/edit" element={<EventEditorPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/resources" element={<ResourceHubPage />} />
          <Route
            path="/resources/new"
            element={
              <RequireAuth min="officeAdmin">
                <ResourceEditorPage />
              </RequireAuth>
            }
          />
          <Route path="/resources/:id" element={<ResourceDetailPage />} />
          <Route
            path="/resources/:id/edit"
            element={
              <RequireAuth min="officeAdmin">
                <ResourceEditorPage />
              </RequireAuth>
            }
          />
          <Route
            path="/tasks/new"
            element={
              <RequireAuth min="officeAdmin">
                <TaskEditorPage />
              </RequireAuth>
            }
          />
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
          <Route
            path="/admin/users"
            element={
              <RequireAuth min="officeAdmin">
                <UsersPage />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/categories"
            element={
              <RequireAuth min="officeAdmin">
                <CategoriesPage />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/banners"
            element={
              <RequireAuth min="officeAdmin">
                <BannersPage />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/settings"
            element={
              <RequireAuth min="broker">
                <SettingsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/templates"
            element={
              <RequireAuth min="broker">
                <TemplatesPage />
              </RequireAuth>
            }
          />
        </Route>
      </Routes>
    </Suspense>
  );
}
