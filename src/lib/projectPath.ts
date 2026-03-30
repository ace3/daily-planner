export interface LocalPathValidation {
  isValid: boolean;
  normalizedPath: string;
  message: string;
}

const CONTROL_CHARS = /[\u0000-\u001F]/;
const WINDOWS_ABSOLUTE_PATH = /^[a-zA-Z]:[\\/]/;
const WINDOWS_UNC_PATH = /^\\\\/;

function trimTrailingSlash(path: string): string {
  if (path === '/') return path;
  if (WINDOWS_UNC_PATH.test(path)) return path.replace(/[\\/]+$/, '');
  if (WINDOWS_ABSOLUTE_PATH.test(path) && path.length <= 3) return path;
  return path.replace(/[\\/]+$/, '');
}

export function normalizeProjectPath(rawPath: string): string {
  return trimTrailingSlash(rawPath.trim());
}

export function isAbsoluteProjectPath(path: string): boolean {
  return path.startsWith('/') || WINDOWS_ABSOLUTE_PATH.test(path) || WINDOWS_UNC_PATH.test(path);
}

export function validateProjectPathLocally(rawPath: string): LocalPathValidation {
  const normalizedPath = normalizeProjectPath(rawPath);

  if (!normalizedPath) {
    return {
      isValid: false,
      normalizedPath,
      message: 'Path is required',
    };
  }

  if (normalizedPath.length > 4096) {
    return {
      isValid: false,
      normalizedPath,
      message: 'Path is too long',
    };
  }

  if (CONTROL_CHARS.test(normalizedPath)) {
    return {
      isValid: false,
      normalizedPath,
      message: 'Path contains invalid control characters',
    };
  }

  if (!isAbsoluteProjectPath(normalizedPath)) {
    return {
      isValid: false,
      normalizedPath,
      message: 'Use an absolute path (e.g. /Users/me/project or C:\\code\\project)',
    };
  }

  return {
    isValid: true,
    normalizedPath,
    message: 'Path format is valid',
  };
}

export function deriveProjectName(path: string): string {
  const normalized = normalizeProjectPath(path);
  if (!normalized) return '';
  const parts = normalized.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  return typeof (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ !== 'undefined';
}
