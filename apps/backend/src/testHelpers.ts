import type { Express } from "express";
import request from "supertest";
import { expect } from "vitest";

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

/** Fund a susu customer via collection batch → coordinator post (field-agent path). */
export async function fundCustomerViaCollection(
  app: Express,
  opts: {
    customerId: string;
    customerName: string;
    amount: number;
    branchId: string;
    agentHeaders: Record<string, string>;
    coordinatorHeaders: Record<string, string>;
  }
): Promise<void> {
  const line = await request(app)
    .post("/api/v1/field-agents/me/collection-batches/lines")
    .set(opts.agentHeaders)
    .send({
      customerId: opts.customerId,
      amount: opts.amount,
      transactionBranchId: opts.branchId
    });
  expect(line.status).toBe(201);

  const submit = await request(app)
    .post("/api/v1/field-agents/me/collection-batches/submit-for-approval")
    .set(opts.agentHeaders)
    .send({
      lines: [
        {
          customerId: opts.customerId,
          customerName: opts.customerName,
          documentAmount: opts.amount,
          appAmount: opts.amount,
          varianceType: "match"
        }
      ],
      summary: {
        totalDocument: opts.amount,
        totalApp: opts.amount,
        totalVariance: 0,
        unresolvedCount: 0
      }
    });
  expect(submit.status).toBe(201);

  const post = await request(app)
    .post("/api/v1/collection-batches/post-all")
    .set({
      "x-user-id": "test-admin-ho",
      "x-tenant-id": opts.coordinatorHeaders["x-tenant-id"] ?? "tenant-demo",
      "x-role": "admin",
      "x-scope-type": "head_office"
    })
    .send({});
  expect(post.status, JSON.stringify(post.body)).toBe(200);
}
