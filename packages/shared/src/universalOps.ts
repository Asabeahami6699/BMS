/** Staff-wide operations — visible to every tenant user (all roles). */
export const UNIVERSAL_OPS_LABEL = "Universal Operations";

export type UniversalOpsNavRow = {
  navPath: string;
  label: string;
};

export const UNIVERSAL_OPS_NAV: UniversalOpsNavRow[] = [
  { navPath: "operations", label: "Dashboard" },
  { navPath: "operations/attendance", label: "Attendance" },
  { navPath: "operations/leave", label: "Leave Management" },
  { navPath: "operations/staff-loans", label: "Staff Loans" },
  { navPath: "operations/announcements", label: "Company Announcements" },
  { navPath: "operations/documents", label: "Documents Center" },
  { navPath: "operations/incidents", label: "Incident Reporting" }
];
