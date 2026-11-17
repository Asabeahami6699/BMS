import { useState } from "react";
import { usePwaInstall } from "./usePwaInstall";

type Variant = "menu" | "button" | "link";

type Props = {
  variant?: Variant;
  className?: string;
  onInstalled?: () => void;
};

export function InstallAppButton({ variant = "button", className, onInstalled }: Props) {
  const { canInstall, installed, isIos, promptInstall } = usePwaInstall();
  const [iosHintOpen, setIosHintOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (installed) {
    return null;
  }

  const showIosHint = isIos && !canInstall;
  if (!canInstall && !showIosHint) {
    return null;
  }

  const label = "Install app";

  const handleClick = async () => {
    if (showIosHint) {
      setIosHintOpen((open) => !open);
      return;
    }
    setBusy(true);
    try {
      const outcome = await promptInstall();
      if (outcome === "accepted") {
        onInstalled?.();
      }
    } finally {
      setBusy(false);
    }
  };

  const classes =
    variant === "menu"
      ? `dash-profile-panel__item${className ? ` ${className}` : ""}`
      : variant === "link"
        ? `install-app-link${className ? ` ${className}` : ""}`
        : `button secondary install-app-button${className ? ` ${className}` : ""}`;

  return (
    <div className={variant === "menu" ? undefined : "install-app"}>
      <button
        type="button"
        className={classes}
        role={variant === "menu" ? "menuitem" : undefined}
        disabled={busy}
        onClick={() => void handleClick()}
      >
        <span aria-hidden>⇩</span> {busy ? "Installing…" : label}
      </button>
      {iosHintOpen ? (
        <p className="install-app__hint muted" role="status">
          On iPhone/iPad: tap Share, then <strong>Add to Home Screen</strong>.
        </p>
      ) : null}
    </div>
  );
}
