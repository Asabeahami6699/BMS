import { z } from "zod";

export const routeAssignmentStrategySchema = z.enum(["registration", "location", "manual"]);
export type RouteAssignmentStrategy = z.infer<typeof routeAssignmentStrategySchema>;

export const ROUTE_ASSIGNMENT_STRATEGY_LABELS: Record<RouteAssignmentStrategy, string> = {
  registration: "Registration-Based",
  location: "Location-Based",
  manual: "Manual"
};

export const ROUTE_ASSIGNMENT_STRATEGY_DESCRIPTIONS: Record<RouteAssignmentStrategy, string> = {
  registration:
    "Preserves the registering mobilizer. Automatically attaches the mobilizer's single active branch route on approval (prompts if multiple exist).",
  location:
    "Organizes customers by their recorded geographical location against route areas and communities. Suggests or assigns unambiguous matches on approval.",
  manual:
    "Administrators explicitly control all customer-to-route and customer-to-mobilizer assignments without automatic changes on registration or location."
};

export const tenantRouteSettingsSchema = z.object({
  tenantId: z.string().min(1),
  strategy: routeAssignmentStrategySchema.default("registration"),
  autoAssignOnApproval: z.boolean().default(true),
  syncAgentOnRouteChange: z.boolean().default(true),
  storageReady: z.boolean().optional(),
  updatedByUserId: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional()
});

export type TenantRouteSettings = z.infer<typeof tenantRouteSettingsSchema>;

export const updateTenantRouteSettingsSchema = z.object({
  strategy: routeAssignmentStrategySchema,
  autoAssignOnApproval: z.boolean().optional(),
  syncAgentOnRouteChange: z.boolean().optional()
});

export type UpdateTenantRouteSettingsInput = z.infer<typeof updateTenantRouteSettingsSchema>;

export const customerAssignmentChangeSourceSchema = z.enum([
  "approval_auto",
  "approval_manual",
  "transfer",
  "route_members",
  "route_agent_sync",
  "reorganization",
  "route_deleted",
  "manual"
]);

export type CustomerAssignmentChangeSource = z.infer<
  typeof customerAssignmentChangeSourceSchema
>;

export const ASSIGNMENT_CHANGE_SOURCE_LABELS: Record<CustomerAssignmentChangeSource, string> = {
  approval_auto: "Approval (Auto)",
  approval_manual: "Approval (Selected)",
  transfer: "Transfer",
  route_members: "Route Members",
  route_agent_sync: "Route Agent Sync",
  reorganization: "Reorganization",
  route_deleted: "Route Deleted",
  manual: "Manual"
};

export const customerAssignmentHistorySchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().min(1),
  customerId: z.string().min(1),
  customerName: z.string().nullable().optional(),
  customerAccountNumber: z.string().nullable().optional(),
  branchId: z.string().min(1),
  previousRouteId: z.string().uuid().nullable().optional(),
  previousRouteName: z.string().nullable().optional(),
  newRouteId: z.string().uuid().nullable().optional(),
  newRouteName: z.string().nullable().optional(),
  previousFieldAgentId: z.string().nullable().optional(),
  previousFieldAgentName: z.string().nullable().optional(),
  newFieldAgentId: z.string().nullable().optional(),
  newFieldAgentName: z.string().nullable().optional(),
  changedByUserId: z.string().min(1),
  changedByName: z.string().nullable().optional(),
  changeSource: customerAssignmentChangeSourceSchema,
  reason: z.string().nullable().optional(),
  createdAt: z.string()
});

export type CustomerAssignmentHistory = z.infer<typeof customerAssignmentHistorySchema>;

export const routeCandidateSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  area: z.string(),
  communities: z.array(z.string()).default([]),
  assignedFieldAgentId: z.string().nullable().optional(),
  assignedFieldAgentName: z.string().nullable().optional()
});

export type RouteCandidateSummary = z.infer<typeof routeCandidateSummarySchema>;

export const routeLocationMatchStatusSchema = z.enum([
  "matched",
  "ambiguous",
  "unmatched",
  "incomplete"
]);

export type RouteLocationMatchStatus = z.infer<typeof routeLocationMatchStatusSchema>;

export const routeLocationSuggestionSchema = z.object({
  customerId: z.string().min(1),
  branchId: z.string().min(1),
  customerLocation: z.string().nullable().optional(),
  matchStatus: routeLocationMatchStatusSchema,
  suggestedRouteId: z.string().uuid().nullable().optional(),
  suggestedRouteName: z.string().nullable().optional(),
  suggestedFieldAgentId: z.string().nullable().optional(),
  suggestedFieldAgentName: z.string().nullable().optional(),
  matchedArea: z.string().nullable().optional(),
  candidateRoutes: z.array(routeCandidateSummarySchema).default([])
});

export type RouteLocationSuggestion = z.infer<typeof routeLocationSuggestionSchema>;

export const approvalRouteRecommendationSchema = z.object({
  strategy: routeAssignmentStrategySchema,
  autoAssignOnApproval: z.boolean(),
  syncAgentOnRouteChange: z.boolean(),
  customerLocation: z.string().nullable().optional(),
  currentAssignedFieldAgentId: z.string().nullable().optional(),
  currentAssignedFieldAgentName: z.string().nullable().optional(),
  recommendedRouteId: z.string().uuid().nullable().optional(),
  recommendedRouteName: z.string().nullable().optional(),
  recommendedFieldAgentId: z.string().nullable().optional(),
  recommendedFieldAgentName: z.string().nullable().optional(),
  willAutoAssign: z.boolean(),
  matchStatus: z.enum(["matched", "ambiguous", "unmatched", "incomplete", "manual"]),
  reason: z.string(),
  candidateRoutes: z.array(routeCandidateSummarySchema).default([]),
  branchActiveRoutes: z.array(routeCandidateSummarySchema).default([])
});

export type ApprovalRouteRecommendation = z.infer<typeof approvalRouteRecommendationSchema>;

export const approveCustomerRegistrationInputSchema = z.object({
  routeId: z.string().uuid().nullable().optional(),
  assignedFieldAgentId: z.string().min(1).nullable().optional(),
  reason: z.string().trim().max(300).optional()
});

export type ApproveCustomerRegistrationInput = z.infer<
  typeof approveCustomerRegistrationInputSchema
>;

export const bulkReorganizeAssignmentItemSchema = z.object({
  customerId: z.string().min(1),
  routeId: z.string().uuid().nullable().optional(),
  assignedFieldAgentId: z.string().min(1).nullable().optional()
});

export const bulkReorganizeCustomersSchema = z.object({
  branchId: z.string().min(1, "Select a branch"),
  reason: z.string().trim().min(3, "Enter a reason for reorganization").max(500),
  syncAgentFromRoute: z.boolean().optional(),
  assignments: z.array(bulkReorganizeAssignmentItemSchema).min(1).max(500)
});

export type BulkReorganizeCustomersInput = z.infer<typeof bulkReorganizeCustomersSchema>;

export const bulkReorganizeChangeItemSchema = z.object({
  customerId: z.string(),
  customerName: z.string(),
  previousRouteId: z.string().uuid().nullable().optional(),
  previousRouteName: z.string().nullable().optional(),
  newRouteId: z.string().uuid().nullable().optional(),
  newRouteName: z.string().nullable().optional(),
  previousFieldAgentId: z.string().nullable().optional(),
  previousFieldAgentName: z.string().nullable().optional(),
  newFieldAgentId: z.string().nullable().optional(),
  newFieldAgentName: z.string().nullable().optional()
});

export const bulkReorganizeResultSchema = z.object({
  updatedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  changes: z.array(bulkReorganizeChangeItemSchema)
});

export type BulkReorganizeResult = z.infer<typeof bulkReorganizeResultSchema>;
