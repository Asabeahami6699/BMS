import { z } from "zod";

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

export const LEAVE_TYPES = [
  "Annual Leave",
  "Sick Leave",
  "Maternity Leave",
  "Compassionate Leave",
  "Study Leave"
] as const;

export const INCIDENT_TYPES = [
  "Cash shortage",
  "Cash surplus",
  "Fraud suspicion",
  "Customer complaint",
  "System issue",
  "Security incident",
  "Operational error"
] as const;

export const ANNOUNCEMENT_CATEGORIES = [
  "Internal news",
  "Product updates",
  "Meetings",
  "Policy changes",
  "Public holidays",
  "Training notices"
] as const;

export const DOCUMENT_CATEGORIES = [
  "HR policies",
  "Staff handbook",
  "Operations manual",
  "Compliance manual",
  "AML guidelines",
  "SOP documents",
  "Circulars",
  "Employment contracts"
] as const;

export const hrStaffLoanSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userName: z.string().optional(),
  amount: z.number(),
  purpose: z.string(),
  termMonths: z.number().int(),
  monthlyDeduction: z.number().nullable().optional(),
  outstandingBalance: z.number().nullable().optional(),
  status: z.enum(["pending", "approved", "declined", "active", "closed"]),
  notes: z.string().optional(),
  reviewedBy: z.string().optional(),
  reviewedAt: z.string().optional(),
  createdAt: z.string()
});

export type HrStaffLoan = z.infer<typeof hrStaffLoanSchema>;

export const createStaffLoanSchema = z.object({
  amount: z.number().positive(),
  purpose: z.string().min(1).max(200),
  termMonths: z.number().int().min(1).max(60),
  notes: z.string().max(500).optional()
});

export const companyAnnouncementSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  category: z.string(),
  pinned: z.boolean(),
  publishedAt: z.string(),
  expiresAt: z.string().nullable().optional(),
  createdBy: z.string().optional(),
  acknowledged: z.boolean().optional()
});

export type CompanyAnnouncement = z.infer<typeof companyAnnouncementSchema>;

export const createAnnouncementSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(5000),
  category: z.string().min(1).max(80),
  pinned: z.boolean().optional(),
  expiresAt: z.string().optional()
});

export const companyDocumentSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  fileUrl: z.string().nullable().optional(),
  version: z.string(),
  uploadedBy: z.string().optional(),
  createdAt: z.string()
});

export type CompanyDocument = z.infer<typeof companyDocumentSchema>;

export const createDocumentSchema = z.object({
  title: z.string().min(1).max(120),
  category: z.string().min(1).max(80),
  fileUrl: z.string().max(4_500_000).optional(),
  version: z.string().max(20).optional()
});

export const incidentReportSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userName: z.string().optional(),
  incidentType: z.string(),
  description: z.string(),
  status: z.enum(["pending", "investigating", "resolved", "closed"]),
  resolutionNotes: z.string().optional(),
  reviewedBy: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type IncidentReport = z.infer<typeof incidentReportSchema>;

export const createIncidentSchema = z.object({
  incidentType: z.string().min(1).max(80),
  description: z.string().min(10).max(3000)
});

export const universalOpsSummarySchema = z.object({
  clockedIn: z.boolean(),
  checkIn: z.string().nullable().optional(),
  checkOut: z.string().nullable().optional(),
  hoursWorked: z.number().optional(),
  leaveAvailable: z.number().int(),
  leavePending: z.number().int(),
  loanOutstanding: z.number().nullable().optional(),
  loanStatus: z.string().optional(),
  openIncidents: z.number().int(),
  unreadAnnouncements: z.number().int()
});

export type UniversalOpsSummary = z.infer<typeof universalOpsSummarySchema>;

export function calculateStaffLoanMonthlyDeduction(amount: number, termMonths: number): number {
  if (termMonths <= 0) {
    return 0;
  }
  return Math.round((amount / termMonths) * 100) / 100;
}
