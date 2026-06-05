import type { Express } from "express";
import request from "supertest";

export async function resolveTestBranchId(
  app: Express,
  headers: Record<string, string>
): Promise<string> {
  const res = await request(app).get("/api/v1/branches").set(headers);
  if (res.status === 200 && Array.isArray(res.body) && res.body[0]?.id) {
    return String(res.body[0].id);
  }
  return "branch-a";
}
