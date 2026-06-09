import { useEffect, type ReactNode } from "react";
import { applyTheme, useThemeStore } from "./themeStore";

type Props = { children: ReactNode };

export function ThemeProvider({ children }: Props) {
  const theme = useThemeStore((s) => s.theme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return children;
}
