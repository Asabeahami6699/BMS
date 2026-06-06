import type { LoanBorrowerRegistration } from "@bms/shared";
import type { Branch } from "../api";
import { AgentPhotoField } from "../../agent/components/AgentPhotoField";

export const EMPTY_BORROWER: LoanBorrowerRegistration = {
  fullName: "",
  email: "",
  phone: "",
  location: "",
  houseNumber: "",
  idCardNumber: "",
  nextOfKin: { fullName: "", phone: "", location: "", houseNumber: "" },
  homeBranchId: ""
};

type Props = {
  value: LoanBorrowerRegistration;
  onChange: (value: LoanBorrowerRegistration) => void;
  branches: Branch[];
  branchLocked?: boolean;
};

export function LoanBorrowerForm({ value, onChange, branches, branchLocked }: Props) {
  function patch(partial: Partial<LoanBorrowerRegistration>) {
    onChange({ ...value, ...partial });
  }

  function patchKin(partial: Partial<LoanBorrowerRegistration["nextOfKin"]>) {
    onChange({ ...value, nextOfKin: { ...value.nextOfKin, ...partial } });
  }

  return (
    <div className="loans-form-grid">
      <div className="loans-form-section field--full">
        <h4>Identity photos</h4>
        <div className="loans-form-grid">
          <AgentPhotoField
            label="Passport photo"
            hint="Clear face photo of the applicant."
            required
            photoUrl={value.photoUrl}
            onPhotoChange={(url) => patch({ photoUrl: url })}
          />
          <AgentPhotoField
            label="ID card photo"
            hint="Front of Ghana Card or valid ID document."
            required
            photoUrl={value.idCardPhotoUrl}
            onPhotoChange={(url) => patch({ idCardPhotoUrl: url })}
          />
        </div>
      </div>

      <label className="field">
        <span>Full name</span>
        <input
          required
          value={value.fullName}
          onChange={(e) => patch({ fullName: e.target.value })}
        />
      </label>
      <label className="field">
        <span>Phone</span>
        <input required value={value.phone} onChange={(e) => patch({ phone: e.target.value })} />
      </label>
      <label className="field">
        <span>Email</span>
        <input
          type="email"
          value={value.email ?? ""}
          onChange={(e) => patch({ email: e.target.value })}
        />
      </label>
      <label className="field">
        <span>Ghana Card / ID number</span>
        <input
          required
          value={value.idCardNumber}
          onChange={(e) => patch({ idCardNumber: e.target.value })}
        />
      </label>
      <label className="field">
        <span>Home branch</span>
        <select
          required
          disabled={branchLocked}
          value={value.homeBranchId}
          onChange={(e) => patch({ homeBranchId: e.target.value })}
        >
          <option value="">Select branch</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} ({b.code})
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Location / area</span>
        <input
          required
          value={value.location}
          onChange={(e) => patch({ location: e.target.value })}
        />
      </label>
      <label className="field">
        <span>House number / GPS</span>
        <input
          required
          value={value.houseNumber}
          onChange={(e) => patch({ houseNumber: e.target.value })}
        />
      </label>

      <div className="loans-form-section field--full">
        <h4>Next of kin</h4>
        <div className="loans-form-grid">
          <label className="field">
            <span>Name</span>
            <input
              required
              value={value.nextOfKin.fullName}
              onChange={(e) => patchKin({ fullName: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Phone</span>
            <input
              required
              value={value.nextOfKin.phone}
              onChange={(e) => patchKin({ phone: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Location</span>
            <input
              required
              value={value.nextOfKin.location}
              onChange={(e) => patchKin({ location: e.target.value })}
            />
          </label>
          <label className="field">
            <span>House number</span>
            <input
              required
              value={value.nextOfKin.houseNumber}
              onChange={(e) => patchKin({ houseNumber: e.target.value })}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
