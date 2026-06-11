import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { CameraCaptureModal } from "../../components/CameraCaptureModal";
import { AdminDataTable } from "../../components/AdminDataTable";
import { useToast } from "../../components/Toast";
import { preparePhoto } from "../../lib/preparePhoto";
import { useUniversalOpsLiveSync } from "../hooks/useUniversalOpsLiveSync";
import { useUniversalOpsStore } from "../stores/universalOpsStore";
import { UniversalOpsQuickLinks, UniversalOpsShell } from "./UniversalOpsShell";

type Props = { displayName?: string };

function formatTime(value?: string | null): string {
  if (!value) {
    return "—";
  }
  return value.slice(0, 5);
}

function calcHours(checkIn?: string | null, checkOut?: string | null): string {
  if (!checkIn) {
    return "0h";
  }
  const [ih, im] = checkIn.split(":").map(Number);
  const end = checkOut ?? new Date().toTimeString().slice(0, 8);
  const [oh, om] = end.split(":").map(Number);
  const mins = oh * 60 + om - (ih * 60 + im);
  return `${Math.max(0, Math.round((mins / 60) * 10) / 10)}h`;
}

export function UniversalOpsAttendancePage({ displayName }: Props) {
  const { showToast } = useToast();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [clockMode, setClockMode] = useState<"in" | "out">("in");
  const [search, setSearch] = useState("");
  useUniversalOpsLiveSync({ scope: "attendance" });

  const {
    today,
    history,
    summary,
    loading,
    actionBusy,
    checkIn,
    checkOut,
    refreshAttendance
  } = useUniversalOpsStore(
    useShallow((s) => ({
      today: s.todayAttendance,
      history: s.attendanceHistory,
      summary: s.summary,
      loading: s.attendanceLoading,
      actionBusy: s.actionBusy,
      checkIn: s.checkIn,
      checkOut: s.checkOut,
      refreshAttendance: s.refreshAttendance
    }))
  );

  const clockedIn = Boolean(today?.checkIn && !today?.checkOut);
  const canCheckOut = Boolean(today?.checkIn && !today?.checkOut);

  function openClock(mode: "in" | "out") {
    setClockMode(mode);
    setCameraOpen(true);
  }

  async function handleCapture(dataUrl: string) {
    setCameraOpen(false);
    try {
      const photoUrl = await preparePhoto(dataUrl);
      if (clockMode === "in") {
        await checkIn(photoUrl);
        showToast("Checked in successfully", "success");
      } else {
        await checkOut(photoUrl);
        showToast("Checked out successfully", "success");
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Attendance failed", "error");
    }
  }

  return (
    <>
      <UniversalOpsShell
        title="Attendance"
        subtitle="Clock in and out with a photo for verification."
        displayName={displayName}
        actions={
          <div className="universal-ops__actions">
            <button
              type="button"
              className="button primary"
              disabled={actionBusy || clockedIn}
              onClick={() => openClock("in")}
            >
              {actionBusy && clockMode === "in" ? "Saving…" : "Clock in"}
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={actionBusy || !canCheckOut}
              onClick={() => openClock("out")}
            >
              {actionBusy && clockMode === "out" ? "Saving…" : "Clock out"}
            </button>
            <button type="button" className="button secondary" onClick={() => void refreshAttendance()}>
              Refresh
            </button>
          </div>
        }
      >
        <section className="card universal-ops__kpi-row">
          <div className="universal-ops__kpi">
            <span className="muted">Clock in</span>
            <strong>{formatTime(today?.checkIn ?? summary?.checkIn)}</strong>
          </div>
          <div className="universal-ops__kpi">
            <span className="muted">Clock out</span>
            <strong>{formatTime(today?.checkOut ?? summary?.checkOut)}</strong>
          </div>
          <div className="universal-ops__kpi">
            <span className="muted">Hours worked</span>
            <strong>{calcHours(today?.checkIn, today?.checkOut)}</strong>
          </div>
          <div className="universal-ops__kpi">
            <span className="muted">Status</span>
            <strong>{clockedIn ? "On duty" : today?.checkOut ? "Completed" : "Not clocked in"}</strong>
          </div>
        </section>

        {today?.checkInPhotoUrl || today?.checkOutPhotoUrl ? (
          <section className="card">
            <h3>Today&apos;s verification photos</h3>
            <div className="universal-ops__photo-row">
              {today.checkInPhotoUrl ? (
                <figure>
                  <img src={today.checkInPhotoUrl} alt="Check-in" className="universal-ops__photo" />
                  <figcaption className="muted">Check in</figcaption>
                </figure>
              ) : null}
              {today.checkOutPhotoUrl ? (
                <figure>
                  <img src={today.checkOutPhotoUrl} alt="Check-out" className="universal-ops__photo" />
                  <figcaption className="muted">Check out</figcaption>
                </figure>
              ) : null}
            </div>
          </section>
        ) : null}

        <AdminDataTable
          variant="desk"
          title="Attendance history"
          subtitle="Your recent clock-in records."
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search date or status…"
          columns={[
            { key: "date", label: "Date" },
            { key: "status", label: "Status" },
            { key: "checkIn", label: "In" },
            { key: "checkOut", label: "Out" },
            { key: "hours", label: "Hours" }
          ]}
          rows={history.map((row) => ({
            id: row.id,
            date: row.businessDate,
            status: row.status,
            checkIn: formatTime(row.checkIn),
            checkOut: formatTime(row.checkOut),
            hours: calcHours(row.checkIn, row.checkOut)
          }))}
          rowKey={(r) => r.id}
          emptyMessage={loading ? "Loading…" : "No attendance history yet."}
        />

        <UniversalOpsQuickLinks excludePath="operations/attendance" />
      </UniversalOpsShell>

      <CameraCaptureModal
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(dataUrl) => void handleCapture(dataUrl)}
      />
    </>
  );
}
