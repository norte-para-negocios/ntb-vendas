'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

export const THEME_INIT_SCRIPT = `
(function() {
  try {
    var stored = localStorage.getItem('theme');
    var dark = stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

const VARIANTS = {
  default: 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]',
  sidebar: 'text-white/45 hover:text-white/80 hover:bg-white/8',
};

export function ThemeToggle({ className = '', variant = 'default' }: { className?: string; variant?: 'default' | 'sidebar' }) {
  const [isDark, setIsDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'));
    setMounted(true);
  }, []);

  const toggle = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
  };

  if (!mounted) return <div className={`w-9 h-9 ${className}`} aria-hidden="true" />;

  return (
    <button
      onClick={toggle}
      className={`u-motion u-press-sm w-9 h-9 flex items-center justify-center rounded-lg shrink-0 ${VARIANTS[variant]} ${className}`}
      title={isDark ? 'Modo claro' : 'Modo escuro'}
      aria-label={isDark ? 'Ativar modo claro' : 'Ativar modo escuro'}
    >
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
