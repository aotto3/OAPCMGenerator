/**
 * Theme control (Slice 18, #50). A manual light / dark / system preference,
 * persisted locally (device-only — never synced, per the PRD's device-only
 * stance). The resolved theme is written to `data-theme` on <html>, which the
 * dark-token block in styles.css keys off. An inline script in index.html sets
 * the same attribute before first paint so there is no light-to-dark flash on
 * load; this module keeps it in sync afterwards and drives the toggle.
 */
import { useEffect, useState } from 'react';

export type ThemePref = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'oap-theme';

// Address-bar / status-bar color per resolved theme (mirrors index.html's
// initial meta and the manifest's teal). Kept in sync on every theme change.
const THEME_COLOR: Record<'light' | 'dark', string> = {
  light: '#00555a',
  dark: '#14201d',
};

const darkQuery = (): MediaQueryList | null =>
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

/** The stored preference, defaulting to 'system' when unset or invalid. */
export function getStoredPref(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    // localStorage unavailable (private mode / SSR) — fall through to default.
  }
  return 'system';
}

/** Resolves a preference to the concrete theme to apply right now. */
export function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref === 'system') return darkQuery()?.matches ? 'dark' : 'light';
  return pref;
}

/** Applies a preference: sets data-theme on <html> and the theme-color meta. */
export function applyTheme(pref: ThemePref): void {
  if (typeof document === 'undefined') return;
  const resolved = resolveTheme(pref);
  document.documentElement.setAttribute('data-theme', resolved);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[resolved]);
}

/**
 * Theme state + setter for the toggle. Persists the choice, applies it, and —
 * while on 'system' — follows OS changes live.
 */
export function useTheme(): { pref: ThemePref; setPref: (p: ThemePref) => void } {
  const [pref, setPrefState] = useState<ThemePref>(getStoredPref);

  useEffect(() => {
    applyTheme(pref);
    if (pref !== 'system') return;
    const mq = darkQuery();
    if (!mq) return;
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [pref]);

  const setPref = (p: ThemePref): void => {
    try {
      localStorage.setItem(STORAGE_KEY, p);
    } catch {
      // Best-effort persistence; applying still works this session.
    }
    setPrefState(p);
  };

  return { pref, setPref };
}
