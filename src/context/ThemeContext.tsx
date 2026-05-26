import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

export type Theme = 'light' | 'dark'

interface ThemeCtxValue {
  theme: Theme
  setTheme: (t: Theme) => void
  toggleTheme: () => void
}

const ThemeCtx = createContext<ThemeCtxValue>({
  theme: 'dark',
  setTheme: () => {},
  toggleTheme: () => {},
})

const STORAGE_KEY = 'dros_crm_theme'

function readInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {}
  return 'dark'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { localStorage.setItem(STORAGE_KEY, theme) } catch {}
  }, [theme])

  const setTheme = (t: Theme) => setThemeState(t)
  const toggleTheme = () => setThemeState(prev => (prev === 'dark' ? 'light' : 'dark'))

  return (
    <ThemeCtx.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeCtx.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeCtx)
}
