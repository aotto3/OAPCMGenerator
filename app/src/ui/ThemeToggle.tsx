import { useTheme, type ThemePref } from './theme';

/**
 * Compact light / dark / system theme switch for the account bar (Slice 18).
 * Three-way so "system" (follow the OS) stays a first-class choice, not just an
 * implicit default.
 */
const OPTIONS: { pref: ThemePref; icon: string; label: string }[] = [
  { pref: 'light', icon: '☀️', label: 'Light theme' },
  { pref: 'dark', icon: '🌙', label: 'Dark theme' },
  { pref: 'system', icon: '💻', label: 'Match system theme' },
];

export function ThemeToggle() {
  const { pref, setPref } = useTheme();
  return (
    <div className="theme-toggle" role="radiogroup" aria-label="Theme">
      {OPTIONS.map((o) => (
        <button
          key={o.pref}
          type="button"
          role="radio"
          aria-checked={pref === o.pref}
          aria-label={o.label}
          title={o.label}
          className={pref === o.pref ? 'is-active' : undefined}
          onClick={() => setPref(o.pref)}
        >
          <span aria-hidden>{o.icon}</span>
        </button>
      ))}
    </div>
  );
}
