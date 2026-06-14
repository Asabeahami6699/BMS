import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  steps: string[];
  label?: string;
};

type PopoverCoords = {
  top: number;
  right: number;
};

export function DeskWorkflowTip({ steps, label = "Show workflow" }: Props) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [coords, setCoords] = useState<PopoverCoords | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popoverId = useId();

  const visible = open || hovered;

  const updatePosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) {
      return;
    }
    const rect = button.getBoundingClientRect();
    setCoords({
      top: rect.bottom + 6,
      right: Math.max(8, window.innerWidth - rect.right)
    });
  }, []);

  const clearLeaveTimer = useCallback(() => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  }, []);

  const showPopover = useCallback(() => {
    clearLeaveTimer();
    setHovered(true);
    updatePosition();
  }, [clearLeaveTimer, updatePosition]);

  const scheduleHidePopover = useCallback(() => {
    if (open) {
      return;
    }
    clearLeaveTimer();
    leaveTimerRef.current = setTimeout(() => {
      setHovered(false);
    }, 140);
  }, [clearLeaveTimer, open]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [visible, updatePosition]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (
        rootRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
      setHovered(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setHovered(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    return () => clearLeaveTimer();
  }, [clearLeaveTimer]);

  if (steps.length === 0) {
    return null;
  }

  const popover =
    visible && coords
      ? createPortal(
          <div
            ref={popoverRef}
            id={popoverId}
            className="role-workspace__workflow-tip-popover role-workspace__workflow-tip-popover--floating"
            role="tooltip"
            style={{ top: coords.top, right: coords.right }}
            onMouseEnter={showPopover}
            onMouseLeave={scheduleHidePopover}
          >
            <p className="role-workspace__workflow-tip-title">Workflow</p>
            <ol className="role-workspace__steps">
              {steps.map((step, index) => (
                <li key={step} className="role-workspace__step">
                  <span className="role-workspace__step-num">{index + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <span
        ref={rootRef}
        className={`role-workspace__workflow-tip${open ? " is-open" : ""}${hovered ? " is-hovered" : ""}`}
        onMouseEnter={showPopover}
        onMouseLeave={scheduleHidePopover}
      >
        <button
          ref={buttonRef}
          type="button"
          className="role-workspace__workflow-tip-btn"
          aria-label={label}
          aria-expanded={visible}
          aria-controls={popoverId}
          onClick={() => {
            setOpen((prev) => {
              const next = !prev;
              if (next) {
                updatePosition();
              }
              return next;
            });
          }}
        >
          <span className="role-workspace__workflow-tip-label">Workflow</span>
          <span className="role-workspace__workflow-tip-icon" aria-hidden>
            i
          </span>
        </button>
      </span>
      {popover}
    </>
  );
}
