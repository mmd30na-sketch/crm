import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import * as api from '../api/client';
import type { ThemeConfig } from '../types';

export const DEFAULT_THEME: ThemeConfig = {
  mode: 'system',
  primary: '#0ea5e9',
  font: 'vazirmatn',
  logo_url: null,
};

const STORAGE_KEY = 'ham_taraz_theme';
const LEGACY_STORAGE_KEY = 'carla_theme'; // read-only fallback from before the rebrand

/** The last theme is kept in localStorage so the first paint never flashes the wrong theme. */
function loadStoredTheme(): ThemeConfig {
  try {
    const raw = (localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY));
    if (raw) return normalizeTheme(JSON.parse(raw));
  } catch {}
  return DEFAULT_THEME;
}

function normalizeTheme(raw: any): ThemeConfig {
  const d = raw && typeof raw === 'object' ? raw : {};
  const primary = typeof d.primary === 'string' ? d.primary.trim() : '';
  return {
    mode: d.mode === 'light' || d.mode === 'dark' || d.mode === 'system' ? d.mode : DEFAULT_THEME.mode,
    primary: /^#[0-9a-fA-F]{6}$/.test(primary) ? primary : DEFAULT_THEME.primary,
    font: d.font === 'vazirmatn' || d.font === 'tahoma' || d.font === 'system' ? d.font : DEFAULT_THEME.font,
    logo_url: typeof d.logo_url === 'string' && d.logo_url.trim() ? d.logo_url.trim() : null,
  };
}

const FONT_STACKS: Record<ThemeConfig['font'], string> = {
  vazirmatn: '"Vazirmatn", ui-sans-serif, system-ui, sans-serif',
  tahoma: 'Tahoma, "Vazirmatn", ui-sans-serif, system-ui, sans-serif',
  system: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
};

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** amount < 0 darkens toward black, > 0 lightens toward white. */
function shade(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const t = amount < 0 ? 0 : 255;
  const p = Math.abs(amount);
  const mix = (c: number) => Math.round(c + (t - c) * p);
  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** Pushes the theme to CSS variables on <html> and toggles the `dark` class. */
export function applyTheme(cfg: ThemeConfig): void {
  const root = document.documentElement;
  const { r, g, b } = hexToRgb(cfg.primary);
  root.style.setProperty('--brand-primary', cfg.primary);
  root.style.setProperty('--brand-primary-rgb', `${r}, ${g}, ${b}`);
  root.style.setProperty('--brand-primary-dark', shade(cfg.primary, -0.15));
  root.style.setProperty('--brand-primary-soft', shade(cfg.primary, 0.92));
  root.style.setProperty('--app-font', FONT_STACKS[cfg.font]);
  const dark = cfg.mode === 'dark'
    || (cfg.mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.classList.toggle('dark', dark);
}

interface ThemeContextValue {
  theme: ThemeConfig;
  /** Applies the theme immediately (CSS variables, `dark` class) and persists it in localStorage. */
  setTheme: (cfg: ThemeConfig) => void;
}

const ThemeContext = createContext<ThemeContextValue>({ theme: DEFAULT_THEME, setTheme: () => undefined });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeConfig>(loadStoredTheme);

  // Apply on startup and on every change, and remember the last theme to avoid a flash.
  useEffect(() => {
    applyTheme(theme);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(theme)); } catch {}
  }, [theme]);

  // Follow the OS while the mode is 'system' (also covers the first paint after a change).
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => { if (theme.mode === 'system') applyTheme(theme); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  // The server is the source of truth: reconcile once on startup (public endpoint).
  useEffect(() => {
    let cancelled = false;
    api.fetchThemeSettings()
      .then((t) => { if (!cancelled && t) setThemeState(t); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const setTheme = useCallback((cfg: ThemeConfig) => setThemeState(cfg), []);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
