import { create } from 'zustand';

interface MobileState {
  mobileMode: boolean;
  moreMenuOpen: boolean;
  desktopSize: { width: number; height: number } | null;
  toggleMobileMode: () => void;
  setMobileMode: (on: boolean) => void;
  setMoreMenuOpen: (open: boolean) => void;
}

const STORAGE_KEY = 'vegr-mobile-mode';
const DESKTOP_SIZE_KEY = 'vegr-desktop-size';

function isWebBrowser(): boolean {
  return typeof (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ === 'undefined';
}

function getInitialMobileMode(): boolean {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved !== null) return saved === '1';
  if (isWebBrowser()) {
    localStorage.setItem(STORAGE_KEY, '1');
    return true;
  }
  return false;
}

const MOBILE_WIDTH = 480;
const MOBILE_HEIGHT = 860;

function getSavedDesktopSize(): { width: number; height: number } | null {
  try {
    const raw = localStorage.getItem(DESKTOP_SIZE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

async function resizeWindowTo(width: number, height: number, minW?: number, minH?: number) {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const { LogicalSize } = await import('@tauri-apps/api/dpi');
    const win = getCurrentWindow();
    if (minW != null && minH != null) {
      await win.setMinSize(new LogicalSize(minW, minH));
    }
    await win.setSize(new LogicalSize(width, height));
  } catch {
    // Not in Tauri environment (dev browser), ignore
  }
}

async function saveCurrentSizeAndGoMobile(): Promise<{ width: number; height: number } | null> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    const size = await win.innerSize();
    const factor = await win.scaleFactor();
    const logical = { width: Math.round(size.width / factor), height: Math.round(size.height / factor) };
    localStorage.setItem(DESKTOP_SIZE_KEY, JSON.stringify(logical));
    await resizeWindowTo(MOBILE_WIDTH, MOBILE_HEIGHT, 360, 600);
    return logical;
  } catch {
    return null;
  }
}

async function restoreDesktopSize(saved: { width: number; height: number } | null) {
  const w = saved?.width ?? 1100;
  const h = saved?.height ?? 750;
  await resizeWindowTo(w, h, 700, 500);
}

export const useMobileStore = create<MobileState>((set, get) => ({
  mobileMode: getInitialMobileMode(),
  moreMenuOpen: false,
  desktopSize: getSavedDesktopSize(),

  toggleMobileMode: () => {
    const current = get().mobileMode;
    const next = !current;
    localStorage.setItem(STORAGE_KEY, next ? '1' : '0');

    if (!isWebBrowser()) {
      if (next) {
        saveCurrentSizeAndGoMobile().then((saved) => {
          if (saved) set({ desktopSize: saved });
        });
      } else {
        restoreDesktopSize(get().desktopSize);
      }
    }

    set({ mobileMode: next, moreMenuOpen: false });
  },

  setMobileMode: (on) => {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
    if (!isWebBrowser()) {
      if (on) {
        saveCurrentSizeAndGoMobile().then((saved) => {
          if (saved) set({ desktopSize: saved });
        });
      } else {
        restoreDesktopSize(get().desktopSize);
      }
    }
    set({ mobileMode: on, moreMenuOpen: false });
  },

  setMoreMenuOpen: (open) => set({ moreMenuOpen: open }),
}));
