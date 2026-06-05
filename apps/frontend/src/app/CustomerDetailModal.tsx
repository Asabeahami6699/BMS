import { useNavigate } from "react-router-dom";
import type { AppRole, Customer } from "./api";
import { useAuth } from "../auth/AuthContext";
import { CustomerDetailsView } from "../components/CustomerDetailsView";
import { Modal } from "../components/Modal";

type Props = {
  open: boolean;
  customer: Customer | null;
  branchLabel?: string;
  onClose: () => void;
};

function canRecordAtCounter(role: AppRole): boolean {
  return role === "admin" || role === "coordinator" || role === "teller" || role === "field_agent";
}

export function CustomerDetailModal({ open, customer, branchLabel, onClose }: Props) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const role = (user?.role ?? "admin") as AppRole;

  if (!customer) {
    return null;
  }

  const showCounterLink = customer.status === "active" && canRecordAtCounter(role);

  const subtitle = [
    customer.accountNumber ? `Acct ${customer.accountNumber}` : null,
    customer.accountType?.replace(/_/g, " "),
    customer.status.replace(/_/g, " ")
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Modal
      open={open}
      title={customer.fullName}
      subtitle={subtitle || "Customer record"}
      onClose={onClose}
      panelClassName="modal-panel--70 modal-panel--customer"
      footer={
        <>
          {showCounterLink ? (
            <button
              type="button"
              className="button"
              onClick={() => {
                onClose();
                navigate(`/app/susu/collections?customerId=${encodeURIComponent(customer.id)}`);
              }}
            >
              Record deposit / withdrawal
            </button>
          ) : null}
          <button type="button" className="button secondary" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <CustomerDetailsView customer={customer} branchLabel={branchLabel} />
    </Modal>
  );
}
