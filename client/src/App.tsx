import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { RequireAuth } from './components/RequireAuth';
import { BoardPage } from './pages/BoardPage';
import { CalendarPage } from './pages/CalendarPage';
import { DashboardPage } from './pages/DashboardPage';
import { DirectoryPage } from './pages/DirectoryPage';
import { EventDetailPage } from './pages/EventDetailPage';
import { EventEditorPage } from './pages/EventEditorPage';
import { FeedPage } from './pages/FeedPage';
import { LoginPage } from './pages/LoginPage';
import { PostEditorPage } from './pages/PostEditorPage';
import { PostPage } from './pages/PostPage';
import { ProfilePage } from './pages/ProfilePage';
import { RegisterPage } from './pages/RegisterPage';
import { SettingsPage } from './pages/admin/SettingsPage';
import { UsersPage } from './pages/admin/UsersPage';

export function App() {
  return (
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
        <Route
          path="/admin/users"
          element={
            <RequireAuth min="officeAdmin">
              <UsersPage />
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
      </Route>
    </Routes>
  );
}
