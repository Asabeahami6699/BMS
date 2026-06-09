import { useThemeStore } from "../theme/themeStore";

type Props = {
  className?: string;
  showLabel?: boolean;
};

export function ThemeToggle({ className = "theme-toggle", showLabel = false }: Props) {
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const isLight = theme === "light";

  return (
    <button
      type="button"
      className={className}
      onClick={toggleTheme}
      aria-label={isLight ? "Switch to dark mode" : "Switch to light mode"}
      title={isLight ? "Switch to dark mode" : "Switch to light mode"}
    >
      <span className="theme-toggle__icon" aria-hidden>
        {isLight ? "🌙" : "☀️"}
      </span>
      {showLabel ? (
        <span className="theme-toggle__label">{isLight ? "Dark mode" : "Light mode"}</span>
      ) : null}
    </button>
  );
}
