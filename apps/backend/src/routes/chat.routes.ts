import { Router } from "express";
import {
  getAdminThreadMessages,
  getVisitorMessages,
  listAdminInbox,
  markAdminThreadRead,
  sendAdminReply,
  sendVisitorMessage,
  startVisitorThread
} from "../services/chatService.js";

export const chatRouter = Router();

chatRouter.post("/threads", async (req, res) => {
  try {
    const result = await startVisitorThread(req.body);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to start chat" });
  }
});

chatRouter.get("/threads/:threadId/messages", async (req, res) => {
  try {
    const since = typeof req.query.since === "string" ? req.query.since : undefined;
    const messages = await getVisitorMessages(String(req.params.threadId), since);
    res.json({ messages });
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : "Thread not found" });
  }
});

chatRouter.post("/threads/:threadId/messages", async (req, res) => {
  try {
    const message = await sendVisitorMessage(String(req.params.threadId), req.body);
    res.status(201).json(message);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to send message" });
  }
});

export const chatInboxRouter = Router();

chatInboxRouter.get("/", async (req, res) => {
  if (!req.userContext || req.userContext.role !== "super_admin") {
    res.status(403).json({ error: "Super admin access required" });
    return;
  }
  const threads = await listAdminInbox();
  res.json(threads);
});

chatInboxRouter.get("/:threadId/messages", async (req, res) => {
  if (!req.userContext || req.userContext.role !== "super_admin") {
    res.status(403).json({ error: "Super admin access required" });
    return;
  }
  try {
    const since = typeof req.query.since === "string" ? req.query.since : undefined;
    const threadId = String(req.params.threadId);
    await markAdminThreadRead(threadId);
    const messages = await getAdminThreadMessages(threadId, since);
    res.json({ messages });
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : "Thread not found" });
  }
});

chatInboxRouter.post("/:threadId/messages", async (req, res) => {
  if (!req.userContext || req.userContext.role !== "super_admin") {
    res.status(403).json({ error: "Super admin access required" });
    return;
  }
  try {
    const message = await sendAdminReply(String(req.params.threadId), req.body);
    res.status(201).json(message);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to send reply" });
  }
});
