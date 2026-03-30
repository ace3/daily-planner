// =============================================================================
// Login.tsx — macOS-inspired auth page with change-password and reset flows
// =============================================================================

import React, { useState, useCallback } from 'react';
import { useAuthStore } from '../stores/authStore';

interface LoginProps {
  /** Called after successful login (and password change if required). */
  onSuccess: () => void;
}

type AuthMode = 'login' | 'force_change' | 'forgot' | 'reset_link';

function getResetTokenFromUrl(): string {
  try {
    return new URLSearchParams(window.location.search).get('reset_token')?.trim() ?? '';
  } catch {
    return '';
  }
}

function clearResetTokenFromUrl(): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('reset_token');
    window.history.replaceState({}, '', url.toString());
  } catch {
    // no-op
  }
}

export const Login: React.FC<LoginProps> = ({ onSuccess }) => {
  const { login, changePassword, forgotPassword, resetPassword } = useAuthStore();

  const initialResetToken = getResetTokenFromUrl();

  // Login / forgot form state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // Change/reset password form state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changeError, setChangeError] = useState('');
  const [changeLoading, setChangeLoading] = useState(false);

  const [resetToken] = useState(initialResetToken);
  const [mode, setMode] = useState<AuthMode>(initialResetToken ? 'reset_link' : 'login');
  const [infoMessage, setInfoMessage] = useState('');

  const handleLogin = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setLoginError('');
      setInfoMessage('');
      if (!username.trim()) {
        setLoginError('Username is required');
        return;
      }
      if (password.length < 6) {
        setLoginError('Password must be at least 6 characters');
        return;
      }
      setLoginLoading(true);
      try {
        const { mustChangePassword } = await login(username, password);
        if (mustChangePassword) {
          setMode('force_change');
        } else {
          onSuccess();
        }
      } catch (err) {
        setLoginError(
          err instanceof Error ? err.message : 'Login failed. Please try again.',
        );
      } finally {
        setLoginLoading(false);
      }
    },
    [username, password, login, onSuccess],
  );

  const handleChangePassword = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setChangeError('');
      if (newPassword.length < 6) {
        setChangeError('Password must be at least 6 characters');
        return;
      }
      if (newPassword !== confirmPassword) {
        setChangeError('Passwords do not match');
        return;
      }
      setChangeLoading(true);
      try {
        await changePassword(newPassword);
        onSuccess();
      } catch (err) {
        setChangeError(
          err instanceof Error ? err.message : 'Failed to change password. Please try again.',
        );
      } finally {
        setChangeLoading(false);
      }
    },
    [newPassword, confirmPassword, changePassword, onSuccess],
  );

  const handleForgotPassword = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setLoginError('');
      setInfoMessage('');
      if (!username.trim()) {
        setLoginError('Username is required');
        return;
      }
      setLoginLoading(true);
      try {
        await forgotPassword(username);
        setInfoMessage('If the account exists, a reset link has been generated and printed to the server console.');
      } catch (err) {
        setLoginError(
          err instanceof Error ? err.message : 'Failed to generate reset link. Please try again.',
        );
      } finally {
        setLoginLoading(false);
      }
    },
    [username, forgotPassword],
  );

  const handleResetPassword = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setChangeError('');
      setInfoMessage('');
      if (!resetToken) {
        setChangeError('Missing reset token');
        return;
      }
      if (newPassword.length < 6) {
        setChangeError('Password must be at least 6 characters');
        return;
      }
      if (newPassword !== confirmPassword) {
        setChangeError('Passwords do not match');
        return;
      }
      setChangeLoading(true);
      try {
        await resetPassword(resetToken, newPassword);
        clearResetTokenFromUrl();
        setNewPassword('');
        setConfirmPassword('');
        setMode('login');
        setInfoMessage('Password reset successful. You can now sign in.');
      } catch (err) {
        setChangeError(
          err instanceof Error ? err.message : 'Failed to reset password. Please try again.',
        );
      } finally {
        setChangeLoading(false);
      }
    },
    [resetToken, newPassword, confirmPassword, resetPassword],
  );

  const subtitle =
    mode === 'force_change'
      ? 'Set a new password'
      : mode === 'forgot'
        ? 'Generate a reset link'
        : mode === 'reset_link'
          ? 'Reset your password'
          : 'Sign in to continue';

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F5F5F7] dark:bg-[#0F1117] px-4">
      <div className="w-full max-w-sm">
        <div className="rounded-2xl bg-white dark:bg-[#161B22] shadow-mac-modal border border-[#D2D2D7] dark:border-gray-700/50 p-8">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0071E3] shadow-lg">
              <svg
                className="h-8 w-8 text-white"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#1D1D1F] dark:text-white">Synq</h1>
            <p className="mt-1 text-sm text-[#6E6E73] dark:text-gray-400">{subtitle}</p>
          </div>

          {infoMessage && (
            <p className="mb-4 rounded-[10px] bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/50 px-3 py-2 text-sm text-green-700 dark:text-green-400">
              {infoMessage}
            </p>
          )}

          {mode === 'login' && (
            <form onSubmit={handleLogin} noValidate className="space-y-4">
              <div>
                <label htmlFor="username" className="block text-sm font-medium text-[#1D1D1F] dark:text-gray-300 mb-1.5">Username</label>
                <input
                  id="username"
                  type="text"
                  autoComplete="username"
                  autoFocus
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded-[10px] border border-[#D2D2D7] dark:border-gray-600 bg-white dark:bg-[#0D1117] px-3 py-2.5 text-sm text-[#1D1D1F] dark:text-white placeholder-[#AEAEB2] dark:placeholder-gray-500 focus:border-[#0071E3] focus:outline-none focus:ring-0 focus:shadow-[0_0_0_3px_rgba(0,113,227,0.2)] transition-shadow"
                  placeholder="admin"
                  disabled={loginLoading}
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-[#1D1D1F] dark:text-gray-300 mb-1.5">Password</label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-[10px] border border-[#D2D2D7] dark:border-gray-600 bg-white dark:bg-[#0D1117] px-3 py-2.5 text-sm text-[#1D1D1F] dark:text-white placeholder-[#AEAEB2] dark:placeholder-gray-500 focus:border-[#0071E3] focus:outline-none focus:ring-0 focus:shadow-[0_0_0_3px_rgba(0,113,227,0.2)] transition-shadow"
                  placeholder="••••••••"
                  disabled={loginLoading}
                />
              </div>

              {loginError && (
                <p className="rounded-[10px] bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 px-3 py-2 text-sm text-red-700 dark:text-red-400">
                  {loginError}
                </p>
              )}

              <button
                type="submit"
                disabled={loginLoading}
                className="w-full rounded-[10px] bg-[#0071E3] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0077ED] focus:outline-none focus:shadow-[0_0_0_3px_rgba(0,113,227,0.35)] disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-150"
              >
                {loginLoading ? 'Signing in…' : 'Sign in'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setLoginError('');
                  setInfoMessage('');
                  setMode('forgot');
                }}
                className="w-full text-sm text-[#0071E3] hover:text-[#0077ED]"
              >
                Forgot password?
              </button>
            </form>
          )}

          {mode === 'forgot' && (
            <form onSubmit={handleForgotPassword} noValidate className="space-y-4">
              <div>
                <label htmlFor="forgot-username" className="block text-sm font-medium text-[#1D1D1F] dark:text-gray-300 mb-1.5">Username</label>
                <input
                  id="forgot-username"
                  type="text"
                  autoComplete="username"
                  autoFocus
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded-[10px] border border-[#D2D2D7] dark:border-gray-600 bg-white dark:bg-[#0D1117] px-3 py-2.5 text-sm text-[#1D1D1F] dark:text-white placeholder-[#AEAEB2] dark:placeholder-gray-500 focus:border-[#0071E3] focus:outline-none focus:ring-0 focus:shadow-[0_0_0_3px_rgba(0,113,227,0.2)] transition-shadow"
                  placeholder="admin"
                  disabled={loginLoading}
                />
              </div>

              {loginError && (
                <p className="rounded-[10px] bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 px-3 py-2 text-sm text-red-700 dark:text-red-400">
                  {loginError}
                </p>
              )}

              <button
                type="submit"
                disabled={loginLoading}
                className="w-full rounded-[10px] bg-[#0071E3] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0077ED] focus:outline-none focus:shadow-[0_0_0_3px_rgba(0,113,227,0.35)] disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-150"
              >
                {loginLoading ? 'Generating…' : 'Generate reset link'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setLoginError('');
                  setInfoMessage('');
                  setMode('login');
                }}
                className="w-full text-sm text-[#0071E3] hover:text-[#0077ED]"
              >
                Back to sign in
              </button>
            </form>
          )}

          {mode === 'force_change' && (
            <form onSubmit={handleChangePassword} noValidate className="space-y-4">
              <div className="rounded-[10px] bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
                You must change your password before continuing.
              </div>

              <div>
                <label htmlFor="new-password" className="block text-sm font-medium text-[#1D1D1F] dark:text-gray-300 mb-1.5">New password</label>
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  autoFocus
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-[10px] border border-[#D2D2D7] dark:border-gray-600 bg-white dark:bg-[#0D1117] px-3 py-2.5 text-sm text-[#1D1D1F] dark:text-white placeholder-[#AEAEB2] dark:placeholder-gray-500 focus:border-[#0071E3] focus:outline-none focus:ring-0 focus:shadow-[0_0_0_3px_rgba(0,113,227,0.2)] transition-shadow"
                  placeholder="Min 6 characters"
                  disabled={changeLoading}
                />
              </div>

              <div>
                <label htmlFor="confirm-password" className="block text-sm font-medium text-[#1D1D1F] dark:text-gray-300 mb-1.5">Confirm new password</label>
                <input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-[10px] border border-[#D2D2D7] dark:border-gray-600 bg-white dark:bg-[#0D1117] px-3 py-2.5 text-sm text-[#1D1D1F] dark:text-white placeholder-[#AEAEB2] dark:placeholder-gray-500 focus:border-[#0071E3] focus:outline-none focus:ring-0 focus:shadow-[0_0_0_3px_rgba(0,113,227,0.2)] transition-shadow"
                  placeholder="••••••••"
                  disabled={changeLoading}
                />
              </div>

              {changeError && (
                <p className="rounded-[10px] bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 px-3 py-2 text-sm text-red-700 dark:text-red-400">
                  {changeError}
                </p>
              )}

              <button
                type="submit"
                disabled={changeLoading}
                className="w-full rounded-[10px] bg-[#0071E3] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0077ED] focus:outline-none focus:shadow-[0_0_0_3px_rgba(0,113,227,0.35)] disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-150"
              >
                {changeLoading ? 'Saving…' : 'Set password'}
              </button>
            </form>
          )}

          {mode === 'reset_link' && (
            <form onSubmit={handleResetPassword} noValidate className="space-y-4">
              <div className="rounded-[10px] bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 px-3 py-2 text-sm text-blue-800 dark:text-blue-300">
                Set a new password for your account.
              </div>

              <div>
                <label htmlFor="reset-new-password" className="block text-sm font-medium text-[#1D1D1F] dark:text-gray-300 mb-1.5">New password</label>
                <input
                  id="reset-new-password"
                  type="password"
                  autoComplete="new-password"
                  autoFocus
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-[10px] border border-[#D2D2D7] dark:border-gray-600 bg-white dark:bg-[#0D1117] px-3 py-2.5 text-sm text-[#1D1D1F] dark:text-white placeholder-[#AEAEB2] dark:placeholder-gray-500 focus:border-[#0071E3] focus:outline-none focus:ring-0 focus:shadow-[0_0_0_3px_rgba(0,113,227,0.2)] transition-shadow"
                  placeholder="Min 6 characters"
                  disabled={changeLoading}
                />
              </div>

              <div>
                <label htmlFor="reset-confirm-password" className="block text-sm font-medium text-[#1D1D1F] dark:text-gray-300 mb-1.5">Confirm new password</label>
                <input
                  id="reset-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-[10px] border border-[#D2D2D7] dark:border-gray-600 bg-white dark:bg-[#0D1117] px-3 py-2.5 text-sm text-[#1D1D1F] dark:text-white placeholder-[#AEAEB2] dark:placeholder-gray-500 focus:border-[#0071E3] focus:outline-none focus:ring-0 focus:shadow-[0_0_0_3px_rgba(0,113,227,0.2)] transition-shadow"
                  placeholder="••••••••"
                  disabled={changeLoading}
                />
              </div>

              {changeError && (
                <p className="rounded-[10px] bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 px-3 py-2 text-sm text-red-700 dark:text-red-400">
                  {changeError}
                </p>
              )}

              <button
                type="submit"
                disabled={changeLoading}
                className="w-full rounded-[10px] bg-[#0071E3] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0077ED] focus:outline-none focus:shadow-[0_0_0_3px_rgba(0,113,227,0.35)] disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-150"
              >
                {changeLoading ? 'Saving…' : 'Reset password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
