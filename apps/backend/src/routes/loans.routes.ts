import { Router, type Request } from "express";
import { requirePermission } from "../middleware/requirePermission.js";
import {
  approveLoanApplication,
  createLoanApplication,
  createLoanProduct,
  disburseLoan,
  getLoanDetail,
  getLoansBootstrap,
  listLoanApplications,
  listLoanProducts,
  recordLoanRepayment,
  rejectLoanApplication,
  updateLoanProduct
} from "../services/loanService.js";
import {
  addLoanGroupMember,
  createLoanGroup,
  getLoanGroupById,
  listLoanGroups,
  removeLoanGroupMember,
  updateLoanGroup
} from "../services/loanGroupService.js";

import { resolveRequestBranchFilter } from "../middleware/branchScope.js";

export const loansRouter = Router();

function contextFromReq(req: Request) {
  const ctx = req.userContext!;
  return {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    role: ctx.role,
    branchId: ctx.branchId
  };
}

loansRouter.get("/bootstrap", requirePermission("loans.read"), async (req, res) => {
  try {
    const tenantId = req.userContext?.tenantId;
    if (!tenantId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    res.json(await getLoansBootstrap(tenantId, resolveRequestBranchFilter(req)));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to load loans" });
  }
});

loansRouter.get("/products", requirePermission("loans.read"), async (req, res) => {
  try {
    const tenantId = req.userContext?.tenantId;
    if (!tenantId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    res.json({ products: await listLoanProducts(tenantId) });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to list products" });
  }
});

loansRouter.post("/products", requirePermission("loans.products.manage"), async (req, res) => {
  try {
    const tenantId = req.userContext?.tenantId;
    if (!tenantId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const product = await createLoanProduct(tenantId, req.body);
    res.status(201).json({ product });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to create product" });
  }
});

loansRouter.patch("/products/:productId", requirePermission("loans.products.manage"), async (req, res) => {
  try {
    const tenantId = req.userContext?.tenantId;
    if (!tenantId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const product = await updateLoanProduct(tenantId, String(req.params.productId), req.body);
    res.json({ product });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to update product" });
  }
});

loansRouter.get("/applications", requirePermission("loans.read"), async (req, res) => {
  try {
    const tenantId = req.userContext?.tenantId;
    if (!tenantId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    res.json({ applications: await listLoanApplications(tenantId) });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to list applications" });
  }
});

loansRouter.get("/applications/:loanId", requirePermission("loans.read"), async (req, res) => {
  try {
    const tenantId = req.userContext?.tenantId;
    if (!tenantId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    res.json(await getLoanDetail(tenantId, String(req.params.loanId)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load loan";
    res.status(message === "Loan not found" ? 404 : 500).json({ error: message });
  }
});

loansRouter.post("/applications", requirePermission("loans.applications.create"), async (req, res) => {
  try {
    if (!req.userContext) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const application = await createLoanApplication(contextFromReq(req), req.body);
    res.status(201).json({ application });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to create application" });
  }
});

loansRouter.post(
  "/applications/:loanId/approve",
  requirePermission("loans.applications.approve"),
  async (req, res) => {
    try {
      if (!req.userContext) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const application = await approveLoanApplication(contextFromReq(req), String(req.params.loanId));
      res.json({ application });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to approve" });
    }
  }
);

loansRouter.post(
  "/applications/:loanId/reject",
  requirePermission("loans.applications.approve"),
  async (req, res) => {
    try {
      if (!req.userContext) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const application = await rejectLoanApplication(contextFromReq(req), String(req.params.loanId), req.body);
      res.json({ application });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to reject" });
    }
  }
);

loansRouter.post("/applications/:loanId/disburse", requirePermission("loans.disburse"), async (req, res) => {
  try {
    if (!req.userContext) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const application = await disburseLoan(contextFromReq(req), String(req.params.loanId));
    res.json({ application });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to disburse" });
  }
});

loansRouter.post(
  "/applications/:loanId/repayments",
  requirePermission("loans.repayments.create"),
  async (req, res) => {
    try {
      if (!req.userContext) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const result = await recordLoanRepayment(contextFromReq(req), String(req.params.loanId), req.body);
      res.status(201).json(result);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to record repayment" });
    }
  }
);

loansRouter.get("/groups", requirePermission("loans.read"), async (req, res) => {
  try {
    const tenantId = req.userContext?.tenantId;
    if (!tenantId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    res.json({ groups: await listLoanGroups(tenantId) });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to list groups" });
  }
});

loansRouter.get("/groups/:groupId", requirePermission("loans.read"), async (req, res) => {
  try {
    const tenantId = req.userContext?.tenantId;
    if (!tenantId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const group = await getLoanGroupById(tenantId, String(req.params.groupId));
    if (!group) {
      res.status(404).json({ error: "Group not found" });
      return;
    }
    res.json({ group });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to load group" });
  }
});

loansRouter.post("/groups", requirePermission("loans.applications.create"), async (req, res) => {
  try {
    if (!req.userContext) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const group = await createLoanGroup(contextFromReq(req), req.body);
    res.status(201).json({ group });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to create group" });
  }
});

loansRouter.patch("/groups/:groupId", requirePermission("loans.applications.create"), async (req, res) => {
  try {
    const tenantId = req.userContext?.tenantId;
    if (!tenantId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const group = await updateLoanGroup(tenantId, String(req.params.groupId), req.body);
    res.json({ group });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to update group" });
  }
});

loansRouter.post("/groups/:groupId/members", requirePermission("loans.applications.create"), async (req, res) => {
  try {
    if (!req.userContext) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const member = await addLoanGroupMember(contextFromReq(req), String(req.params.groupId), req.body);
    res.status(201).json({ member });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to add member" });
  }
});

loansRouter.delete(
  "/groups/:groupId/members/:memberId",
  requirePermission("loans.applications.create"),
  async (req, res) => {
    try {
      if (!req.userContext) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      await removeLoanGroupMember(contextFromReq(req), String(req.params.groupId), String(req.params.memberId));
      res.status(204).send();
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to remove member" });
    }
  }
);
