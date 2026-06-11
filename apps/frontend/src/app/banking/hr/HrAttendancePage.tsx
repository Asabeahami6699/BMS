import { FormEvent, useEffect, useMemo, useState } from "react";
import type { HrAttendanceRecord } from "@bms/shared";
import { useShallow } from "zustand/react/shallow";
import { AdminDataTable, filterRowsBySearch } from "../../../components/AdminDataTable";
import { useToast } from "../../../components/Toast";
import { useHrDeskStore } from "../../stores/hrDeskStore";
import { HrSectionShell } from "./HrSectionShell";

type Props = { displayName?: string; canManage: boolean };

export function HrAttendancePage({ displayName, canManage }: Props) {
  const { showToast } = useToast();
  const [userId, setUserId] = useState("");
  const [status, setStatus] = useState<HrAttendanceRecord["status"]>("present");
  const [search, setSearch] = useState("");

  const {
    rows,
    users,
    businessDate,
    dateFrom,
    dateTo,
    loading,
    error,
    lastFetchedAt,
    setAttendanceDate,
    setAttendanceDateRange,
    hydrateAttendance,
    refreshAttendance,
    saveAttendance,
    startLiveSync,
    stopLiveSync
  } = useHrDeskStore(
    useShallow((s) => ({
      rows: s.attendanceRows,
      users: s.users,
      businessDate: s.attendanceDate,
      dateFrom: s.attendanceDateFrom,
      dateTo: s.attendanceDateTo,
      loading: s.attendanceLoading,
      error: s.attendanceError,
      lastFetchedAt: s.lastAttendanceAt,
      setAttendanceDate: s.setAttendanceDate,
      setAttendanceDateRange: s.setAttendanceDateRange,
      hydrateAttendance: s.hydrateAttendance,
      refreshAttendance: s.refreshAttendance,
      saveAttendance: s.saveAttendance,
      startLiveSync: s.startLiveSync,
      stopLiveSync: s.stopLiveSync
    }))
  );

  useEffect(() => {
    hydrateAttendance({ force: true });
    startLiveSync();
    return () => stopLiveSync();
  }, [hydrateAttendance, startLiveSync, stopLiveSync]);

  const staffOptions = useMemo(
    () =>
      users.map((u) => ({
        userId: u.userId,
        label: u.fullName ? `${u.fullName} (${u.email})` : u.email
      })),
    [users]
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!userId) {
      return;
    }
    try {
      await saveAttendance({ userId, businessDate, status });
      showToast("Attendance saved", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed", "error");
    }
  }

  const updatedLabel = lastFetchedAt
    ? `Updated ${new Date(lastFetchedAt).toLocaleTimeString()}`
    : undefined;

  const rangeLabel =
    dateFrom === dateTo ? dateFrom : `${dateFrom} to ${dateTo}`;

  return (
    <HrSectionShell
      title="Attendance"
      subtitle="Universal Operations check-ins and HR attendance register."
      displayName={displayName}
      loading={loading && rows.length === 0}
      error={error}
      updatedLabel={updatedLabel}
      onRefresh={() => void refreshAttendance()}
      refreshing={loading}
    >
      <section className="card stack-form">
        <div className="back-office-balancing-head__filters">
          <label className="field">
            <span>From</span>
            <input
              type="date"
              value={dateFrom}
              max={dateTo}
              onChange={(e) => setAttendanceDateRange(e.target.value, dateTo)}
            />
          </label>
          <label className="field">
            <span>To</span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom}
              onChange={(e) => setAttendanceDateRange(dateFrom, e.target.value)}
            />
          </label>
        </div>
        <p className="muted">
          Includes all staff check-in/out from Universal Operations plus manual HR entries.
        </p>
      </section>

      {canManage ? (
        <form className="card stack-form" onSubmit={handleSubmit}>
          <h3>Mark attendance</h3>
          <label className="field">
            <span>Business date</span>
            <input
              type="date"
              value={businessDate}
              onChange={(e) => setAttendanceDate(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Employee</span>
            <select value={userId} onChange={(e) => setUserId(e.target.value)} required>
              <option value="">Select employee…</option>
              {staffOptions.map((u) => (
                <option key={u.userId} value={u.userId}>
                  {u.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as HrAttendanceRecord["status"])}>
              <option value="present">Present</option>
              <option value="late">Late</option>
              <option value="absent">Absent</option>
              <option value="leave">On leave</option>
            </select>
          </label>
          <button type="submit" className="button primary">
            Save attendance
          </button>
        </form>
      ) : null}

      <AdminDataTable
        variant="desk"
        title="Attendance register"
        subtitle={`Check-ins and presence for ${rangeLabel}.`}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search employee, date, or status…"
        columns={[
          { key: "userName", label: "Employee" },
          { key: "businessDate", label: "Date" },
          { key: "status", label: "Status" },
          { key: "checkIn", label: "Check-in" },
          { key: "checkOut", label: "Check-out" },
          {
            key: "photos",
            label: "Photos",
            render: (row) =>
              row.raw.checkInPhotoUrl || row.raw.checkOutPhotoUrl ? (
                <span className="universal-ops__photo-badges">
                  {row.raw.checkInPhotoUrl ? "In ✓" : ""}
                  {row.raw.checkOutPhotoUrl ? " Out ✓" : ""}
                </span>
              ) : (
                "—"
              )
          }
        ]}
        rows={filterRowsBySearch(
          rows.map((r) => ({
            id: r.id,
            userName: r.userName ?? r.userId,
            businessDate: r.businessDate,
            status: r.status,
            checkIn: r.checkIn?.slice(0, 5) ?? "—",
            checkOut: r.checkOut?.slice(0, 5) ?? "—",
            raw: r
          })),
          search,
          ["userName", "status", "businessDate"]
        )}
        rowKey={(r) => r.id}
        emptyMessage={loading ? "Loading…" : "No attendance in this date range."}
      />
    </HrSectionShell>
  );
}
