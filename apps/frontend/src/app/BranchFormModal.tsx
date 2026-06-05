import { FormEvent, useEffect, useState } from "react";
import type { Branch } from "./api";
import { createBranch, updateBranch } from "./api";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";

type Mode = "create" | "edit";

type Props = {
  open: boolean;
  mode: Mode;
  branch: Branch | null;
  onClose: () => void;
  onSaved: () => void;
};

export function BranchFormModal({ open, mode, branch, onClose, onSaved }: Props) {
  const { showToast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"active" | "inactive">("active");

  useEffect(() => {
    if (!open) {
      return;
    }
    if (mode === "edit" && branch) {
      setCode(branch.code);
      setName(branch.name);
      setStatus(branch.status ?? "active");
    } else {
      setCode("");
      setName("");
      setStatus("active");
    }
  }, [open, mode, branch]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      if (mode === "create") {
        await createBranch({ code, name });
        showToast("Branch created", "success");
      } else if (branch) {
        await updateBranch(branch.id, { code, name, status });
        showToast("Branch updated", "success");
      }
      onSaved();
      onClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to save branch", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      title={mode === "create" ? "Add branch" : "Edit branch"}
      subtitle={mode === "create" ? "Create a new branch for this company." : "Update branch details or status."}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="branch-form" className="button" disabled={submitting}>
            {submitting ? "Saving…" : mode === "create" ? "Create branch" : "Save changes"}
          </button>
        </>
      }
    >
      <form id="branch-form" className="stack-form" onSubmit={handleSubmit}>
        {mode === "edit" && branch ? (
          <label className="field">
            <span>Branch ID</span>
            <input value={branch.id} disabled readOnly />
          </label>
        ) : (
          <p className="muted">A unique branch ID is assigned automatically when you save.</p>
        )}
        <label className="field">
          <span>Branch code</span>
          <input value={code} onChange={(e) => setCode(e.target.value)} required />
        </label>
        <label className="field">
          <span>Branch name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        {mode === "edit" ? (
          <label className="field">
            <span>Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as "active" | "inactive")}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        ) : null}
      </form>
    </Modal>
  );
}
