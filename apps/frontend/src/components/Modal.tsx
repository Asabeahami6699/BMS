import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";

type Props = {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** e.g. `modal-panel--70` for 70vw × 70vh */
  panelClassName?: string;
  /** Draw above another open modal. */
  stacked?: boolean;
  /** When false, Escape and the backdrop leave this modal open. */
  captureDismiss?: boolean;
  titleId?: string;
};

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  origX: number;
  origY: number;
};

export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  panelClassName,
  stacked = false,
  captureDismiss = true,
  titleId = "modal-title"
}: Props) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<DragState | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open || !captureDismiss) {
      return;
    }
    setOffset({ x: 0, y: 0 });
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current();
      }
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, captureDismiss]);

  function startDrag(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest(".modal-close") || target.closest("button, a, input, select, textarea, label")) {
      return;
    }
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origX: offset.x,
      origY: offset.y
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function moveDrag(event: PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    setOffset({
      x: drag.origX + event.clientX - drag.startX,
      y: drag.origY + event.clientY - drag.startY
    });
  }

  function endDrag(event: PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div
      className={stacked ? "modal-backdrop modal-backdrop--stacked" : "modal-backdrop"}
      role="presentation"
      onClick={captureDismiss ? onClose : undefined}
    >
      <div
        className={panelClassName ? `modal-panel ${panelClassName}` : "modal-panel"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        onClick={(event) => event.stopPropagation()}
      >
        <header
          className="modal-header modal-header--draggable"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div className="modal-header__text">
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <p className="muted modal-subtitle">{subtitle}</p> : null}
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </div>
    </div>
  );
}
