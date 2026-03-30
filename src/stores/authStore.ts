// =============================================================================
// authStore.ts — Zustand store for session-based authentication
// =============================================================================

import { create } from 'zustand';
import { httpPost, httpGet } from '../lib/http';

interface MeResponse {
  username: string;
  must_change_password: boolean;
}

interface LoginResponse {
  must_change_password: boolean;
}

interface AuthState {
  isAuthenticated: boolean;
  mustChangePassword: boolean;
  username: string | null;
  /** True while the initial auth check is in flight. */
  isChecking: boolean;

  /** Call on app mount. Sets isAuthenticated based on GET /api/auth/me. */
  checkAuth: () => Promise<void>;

  /** POST /api/auth/login — sets cookie on success. */
  login: (
    username: string,
    password: string,
  ) => Promise<{ mustChangePassword: boolean }>;

  /** POST /api/auth/logout — clears cookie and local state. */
  logout: () => Promise<void>;

  /** POST /api/auth/change-password — updates password server-side. */
  changePassword: (newPassword: string) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  mustChangePassword: false,
  username: null,
  isChecking: true,

  checkAuth: async () => {
    set({ isChecking: true });
    try {
      const me = await httpGet<MeResponse>('/api/auth/me');
      set({
        isAuthenticated: true,
        mustChangePassword: me.must_change_password,
        username: me.username,
      });
    } catch {
      // 401 or network error → not authenticated
      set({ isAuthenticated: false, mustChangePassword: false, username: null });
    } finally {
      set({ isChecking: false });
    }
  },

  login: async (username: string, password: string) => {
    const res = await httpPost<LoginResponse>('/api/auth/login', {
      username,
      password,
    });
    set({
      isAuthenticated: true,
      mustChangePassword: res.must_change_password,
      username,
    });
    return { mustChangePassword: res.must_change_password };
  },

  logout: async () => {
    try {
      await httpPost('/api/auth/logout', {});
    } catch {
      // Best-effort — clear local state regardless
    }
    set({ isAuthenticated: false, mustChangePassword: false, username: null });
  },

  changePassword: async (newPassword: string) => {
    await httpPost('/api/auth/change-password', { new_password: newPassword });
    set({ mustChangePassword: false });
  },
}));
