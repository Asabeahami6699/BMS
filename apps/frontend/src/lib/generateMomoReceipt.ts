export type MomoReceiptInput = {
  customerName: string;
  amount: number;
  momoNumber: string;
  momoAccountName: string;
  payoutReference?: string;
  tenantName?: string;
  paidAt?: Date;
};

export async function generateMomoReceiptDataUrl(input: MomoReceiptInput): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 880;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not generate receipt");
  }

  const paidLabel = (input.paidAt ?? new Date()).toLocaleString();
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, canvas.width, 120);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 28px system-ui, sans-serif";
  ctx.fillText("BMS MoMo Payout Receipt", 32, 52);
  ctx.font = "16px system-ui, sans-serif";
  ctx.fillText(input.tenantName ?? "Susu payout", 32, 88);

  let y = 160;
  const lines: [string, string][] = [
    ["Customer", input.customerName],
    ["Amount", `GHS ${input.amount.toFixed(2)}`],
    ["MoMo name", input.momoAccountName],
    ["MoMo number", input.momoNumber],
    ["Paid at", paidLabel]
  ];
  if (input.payoutReference?.trim()) {
    lines.push(["Reference", input.payoutReference.trim()]);
  }

  ctx.fillStyle = "#334155";
  ctx.font = "14px system-ui, sans-serif";
  for (const [label, value] of lines) {
    ctx.fillStyle = "#64748b";
    ctx.fillText(label, 32, y);
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 20px system-ui, sans-serif";
    const wrapped = wrapText(ctx, value, 32, y + 28, 576, 26);
    y = wrapped + 24;
    ctx.font = "14px system-ui, sans-serif";
  }

  ctx.strokeStyle = "#cbd5e1";
  ctx.strokeRect(24, 24, canvas.width - 48, canvas.height - 48);

  return canvas.toDataURL("image/jpeg", 0.92);
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
): number {
  const words = text.split(" ");
  let line = "";
  let currentY = y;
  for (let i = 0; i < words.length; i++) {
    const test = line + words[i] + " ";
    if (ctx.measureText(test).width > maxWidth && i > 0) {
      ctx.fillText(line, x, currentY);
      line = words[i] + " ";
      currentY += lineHeight;
    } else {
      line = test;
    }
  }
  ctx.fillText(line, x, currentY);
  return currentY;
}
