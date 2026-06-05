import { z } from "zod";

export const BMS_CONTACT_EMAIL = "asabeahami6699@gmail.com";

export const startChatThreadSchema = z.object({
  visitorName: z.string().min(1),
  companyName: z.string().min(1),
  visitorEmail: z.string().email(),
  message: z.string().min(1).max(2000)
});

export const sendChatMessageSchema = z.object({
  message: z.string().min(1).max(2000)
});

export const chatMessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  senderType: z.enum(["visitor", "admin"]),
  body: z.string(),
  createdAt: z.string()
});

export const chatThreadSchema = z.object({
  id: z.string(),
  visitorName: z.string(),
  companyName: z.string(),
  visitorEmail: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastMessage: z.string().optional(),
  unreadForAdmin: z.number().optional()
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type ChatThread = z.infer<typeof chatThreadSchema>;
