const STORAGE_KEY = 'powerbia.theme';

export type Theme = 'light' | 'dark';

/**
 * The mode stays light/dark throughout the app — the chart palette and axis ink
 * are keyed on the surface, not on whichever daisyUI theme paints it. Only this
 * map knows the theme names, so swapping one is a one-line change.
 */
const DAISY_THEME: Record<Theme, string> = { light: 'light', dark: 'black' };

export function storedTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') return saved;

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: Theme) {
  localStorage.setItem(STORAGE_KEY, theme);
  document.documentElement.dataset.theme = DAISY_THEME[theme];
}
