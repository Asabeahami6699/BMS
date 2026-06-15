import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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

const MENU_MIN_WIDTH_PX = 168;

function clampMenuLeft(triggerRight: number): number {
  const left = triggerRight - MENU_MIN_WIDTH_PX;
  return Math.max(8, Math.min(left, window.innerWidth - MENU_MIN_WIDTH_PX - 8));
}

export function RowActionsMenu({ items, ariaLabel = "Row actions", triggerLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const menuId = useId();

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setMenuPosition(null);
      return;
    }
    const rect = triggerRef.current.getBoundingClientRect();
    setMenuPosition({
      top: rect.bottom + 4,
      left: clampMenuLeft(rect.right)
    });
  }, [open, items.length]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    function onDismiss() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onDismiss, true);
    window.addEventListener("resize", onDismiss);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onDismiss, true);
      window.removeEventListener("resize", onDismiss);
    };
  }, [open]);

  function runAction(item: RowActionItem) {
    setOpen(false);
    item.onClick();
  }

  if (items.length === 0) {
    return null;
  }

  const menu =
    open && menuPosition ? (
      <ul
        id={menuId}
        ref={menuRef}
        className="row-actions-menu row-actions-menu--overlay"
        role="menu"
        style={{ top: menuPosition.top, left: menuPosition.left }}
      >
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
    ) : null;

  return (
    <div className="row-actions" ref={rootRef}>
      <button
        ref={triggerRef}
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
      {menu ? createPortal(menu, document.body) : null}
    </div>
  );
}
