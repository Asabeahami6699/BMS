import { useEffect, useId, useRef, useState } from "react";

export type RowActionItem = {
  label: string;
  onClick: () => void;
  danger?: boolean;
};

type Props = {
  items: RowActionItem[];
  ariaLabel?: string;
  /** When set, shows a labeled trigger (e.g. "Action") instead of the ⋮ icon. */
  triggerLabel?: string;
};

export function RowActionsMenu({ items, ariaLabel = "Row actions", triggerLabel }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function runAction(item: RowActionItem) {
    setOpen(false);
    item.onClick();
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="row-actions" ref={rootRef}>
      <button
        type="button"
        className={`row-actions-trigger${triggerLabel ? " row-actions-trigger--label" : ""}`}
        aria-label={triggerLabel ? undefined : ariaLabel}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        onClick={() => setOpen((prev) => !prev)}
      >
        {triggerLabel ? (
          <>
            {triggerLabel}
            <span className="row-actions-trigger__chev" aria-hidden>
              ▾
            </span>
          </>
        ) : (
          <span aria-hidden>⋮</span>
        )}
      </button>
      {open ? (
        <ul id={menuId} className="row-actions-menu" role="menu">
          {items.map((item) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                className={`row-actions-item${item.danger ? " row-actions-item--danger" : ""}`}
                onClick={() => runAction(item)}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
