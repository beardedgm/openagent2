import { Bell, CalendarDays, LayoutDashboard, LogOut, Megaphone, Menu, Newspaper, Settings, UserSquare, Users } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useLogout, useMe, useNotifications, usePublicSettings } from '../api/hooks';
import { useUiStore } from '../store/uiStore';
import { applyAccentColor } from '../utils/applyAccentColor';
import { NotificationsDrawer } from './NotificationsDrawer';

// Below this viewport width, the 240px sidebar no longer fits comfortably alongside content
// (see DESIGN.md §7). The sidebar becomes an off-canvas overlay, toggled by the same
// sidebarOpen state and Menu button used to collapse it on wider viewports.
const SIDEBAR_COLLAPSE_BREAKPOINT = 880;

const iconButtonStyle: CSSProperties = {
  width: 44,
  height: 44,
  display: 'grid',
  placeItems: 'center',
  background: 'transparent',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-text)',
};

function navLinkStyle(isActive: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    minHeight: 44,
    padding: '0 var(--space-3)',
    borderRadius: 'var(--radius-sm)',
    textDecoration: 'none',
    color: isActive ? 'var(--color-accent)' : 'var(--color-text)',
    background: isActive ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)' : 'transparent',
    fontWeight: isActive ? 700 : 500,
  };
}

export function AppShell() {
  const { data: branding } = usePublicSettings();
  const { data: me } = useMe();
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const logout = useLogout();
  const navigate = useNavigate();
  const [notifOpen, setNotifOpen] = useState(false);
  const { data: notifData } = useNotifications();
  const unread = notifData?.unreadCount ?? 0;

  useEffect(() => {
    if (branding?.primaryColor) applyAccentColor(branding.primaryColor);
  }, [branding?.primaryColor]);

  const isAdmin = me?.role === 'officeAdmin' || me?.role === 'broker';
  const isBroker = me?.role === 'broker';

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--color-bg)' }}>
      {sidebarOpen && (
        <nav
          aria-label="Main navigation"
          className="app-shell-sidebar"
          style={{
            width: 240,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-1)',
            padding: 'var(--space-4)',
            background: 'var(--color-surface)',
            borderRight: '1px solid var(--color-border)',
          }}
        >
          <NavLink to="/" end style={({ isActive }) => navLinkStyle(isActive)}>
            <LayoutDashboard size={18} />
            Home
          </NavLink>
          <NavLink to="/directory" style={({ isActive }) => navLinkStyle(isActive)}>
            <UserSquare size={18} />
            Directory
          </NavLink>
          <NavLink to="/board" style={({ isActive }) => navLinkStyle(isActive)}>
            <Megaphone size={18} />
            Message Board
          </NavLink>
          <NavLink to="/feed" style={({ isActive }) => navLinkStyle(isActive)}>
            <Newspaper size={18} />
            Feed
          </NavLink>
          <NavLink to="/calendar" style={({ isActive }) => navLinkStyle(isActive)}>
            <CalendarDays size={18} />
            Calendar
          </NavLink>
          {isAdmin && (
            <>
              <div
                style={{
                  marginTop: 'var(--space-4)',
                  marginBottom: 'var(--space-1)',
                  padding: '0 var(--space-3)',
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                  color: 'var(--color-text-muted)',
                }}
              >
                ADMIN
              </div>
              <NavLink to="/admin/users" style={({ isActive }) => navLinkStyle(isActive)}>
                <Users size={18} />
                Users
              </NavLink>
              {isBroker && (
                <NavLink to="/admin/settings" style={({ isActive }) => navLinkStyle(isActive)}>
                  <Settings size={18} />
                  Settings
                </NavLink>
              )}
            </>
          )}
        </nav>
      )}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header
          style={{
            height: 64,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            padding: '0 var(--space-5)',
            background: 'var(--color-surface)',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <button
            aria-label="Toggle navigation"
            aria-expanded={sidebarOpen}
            onClick={toggleSidebar}
            style={iconButtonStyle}
          >
            <Menu size={20} />
          </button>
          {branding?.logoUrl && <img src={branding.logoUrl} alt="" style={{ height: 32 }} />}
          <strong style={{ fontSize: 16 }}>{branding?.brandName ?? 'Workspace'}</strong>
          <div style={{ flex: 1 }} />
          <button
            aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
            aria-expanded={notifOpen}
            onClick={() => setNotifOpen((o) => !o)}
            style={{ ...iconButtonStyle, position: 'relative' }}
          >
            <Bell size={20} />
            {unread > 0 && (
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  minWidth: 18,
                  height: 18,
                  padding: '0 4px',
                  borderRadius: 999,
                  display: 'grid',
                  placeItems: 'center',
                  background: 'var(--color-accent)',
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </button>
          {me && (
            <button
              onClick={() => navigate(`/profile/${me.id}`)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                minHeight: 44,
                padding: '0 var(--space-2)',
                background: 'transparent',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-text)',
                fontWeight: 600,
              }}
            >
              {me.photoUrl ? (
                <img
                  src={me.photoUrl}
                  alt=""
                  style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }}
                />
              ) : (
                <span
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    background: 'var(--color-accent)',
                    color: '#fff',
                    fontSize: 14,
                    fontWeight: 700,
                  }}
                >
                  {me.displayName?.[0]?.toUpperCase() ?? '?'}
                </span>
              )}
              {me.displayName}
            </button>
          )}
          <button
            aria-label="Sign out"
            onClick={() => logout.mutate(undefined, { onSuccess: () => navigate('/login') })}
            style={iconButtonStyle}
          >
            <LogOut size={20} />
          </button>
        </header>
        <main
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            maxWidth: 1100,
            width: '100%',
            margin: '0 auto',
            padding: 'var(--space-5)',
          }}
        >
          <Outlet />
        </main>
      </div>
      <style>{`
        @media (max-width: ${SIDEBAR_COLLAPSE_BREAKPOINT}px) {
          .app-shell-sidebar {
            position: fixed;
            top: 64px;
            bottom: 0;
            left: 0;
            z-index: 20;
            box-shadow: var(--shadow-md);
          }
        }
      `}</style>
      <NotificationsDrawer open={notifOpen} onClose={() => setNotifOpen(false)} />
    </div>
  );
}
