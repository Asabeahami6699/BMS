import { useCallback, useRef, useState } from "react";

type ConfirmOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
};

type ConfirmState = ConfirmOptions & {
  open: boolean;
  loading: boolean;
};

const CLOSED: ConfirmState = { open: false, loading: false, message: "" };

export function useConfirmDialog() {
  const [state, setState] = useState<ConfirmState>(CLOSED);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({ ...options, open: true, loading: false });
    });
  }, []);

  const close = useCallback((result: boolean) => {
    resolveRef.current?.(result);
    resolveRef.current = null;
    setState(CLOSED);
  }, []);

  const handleConfirm = useCallback(() => {
    setState((prev) => ({ ...prev, loading: true }));
    close(true);
  }, [close]);

  const handleCancel = useCallback(() => {
    close(false);
  }, [close]);

  return {
    confirm,
    dialogProps: {
      open: state.open,
      title: state.title,
      message: state.message,
      confirmLabel: state.confirmLabel,
      danger: state.danger,
      loading: state.loading,
      onConfirm: handleConfirm,
      onCancel: handleCancel
    }
  };
}
