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
const VIEWPORT_PAD_PX = 8;

type MenuPosition = {
  top: number;
  left: number;
  maxHeight?: number;
};

function clampMenuLeft(triggerRight: number, menuWidth: number): number {
  const left = triggerRight - menuWidth;
  return Math.max(VIEWPORT_PAD_PX, Math.min(left, window.innerWidth - menuWidth - VIEWPORT_PAD_PX));
}

function placeMenu(trigger: DOMRect, menuWidth: number, menuHeight: number): MenuPosition {
  const left = clampMenuLeft(trigger.right, menuWidth);
  const spaceBelow = window.innerHeight - trigger.bottom - VIEWPORT_PAD_PX;
  const spaceAbove = trigger.top - VIEWPORT_PAD_PX;
  const openUp = spaceBelow < menuHeight && spaceAbove > spaceBelow;

  if (openUp) {
    const top = Math.max(VIEWPORT_PAD_PX, trigger.top - menuHeight - 4);
    const maxHeight = Math.max(120, trigger.top - VIEWPORT_PAD_PX - 4);
    return { top, left, maxHeight };
  }

  const top = trigger.bottom + 4;
  const maxHeight = Math.max(120, window.innerHeight - top - VIEWPORT_PAD_PX);
  return { top, left, maxHeight };
}

export function RowActionsMenu({ items, ariaLabel = "Row actions", triggerLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const menuId = useId();

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setMenuPosition(null);
      return;
    }

    const trigger = triggerRef.current.getBoundingClientRect();
    const estimatedHeight = Math.max(items.length * 40 + 12, 44);
    let next = placeMenu(trigger, MENU_MIN_WIDTH_PX, estimatedHeight);
    setMenuPosition(next);

    // Second pass after paint so we can use the real menu height near the viewport edge.
    const frame = window.requestAnimationFrame(() => {
      if (!triggerRef.current || !menuRef.current) {
        return;
      }
      const liveTrigger = triggerRef.current.getBoundingClientRect();
      const liveWidth = Math.max(MENU_MIN_WIDTH_PX, menuRef.current.offsetWidth);
      const liveHeight = menuRef.current.scrollHeight || estimatedHeight;
      next = placeMenu(liveTrigger, liveWidth, liveHeight);
      setMenuPosition(next);
    });

    return () => window.cancelAnimationFrame(frame);
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

    function reposition() {
      if (!triggerRef.current || !menuRef.current) {
        return;
      }
      const trigger = triggerRef.current.getBoundingClientRect();
      const width = Math.max(MENU_MIN_WIDTH_PX, menuRef.current.offsetWidth);
      const height = menuRef.current.scrollHeight || items.length * 40 + 12;
      setMenuPosition(placeMenu(trigger, width, height));
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    // Reposition on scroll/resize instead of closing — keeps the menu visible on last rows.
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, items.length]);

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
        style={{
          top: menuPosition.top,
          left: menuPosition.left,
          maxHeight: menuPosition.maxHeight,
          overflowY: "auto"
        }}
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
