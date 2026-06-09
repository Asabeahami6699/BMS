const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen"
];

const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function chunkToWords(value: number): string {
  if (value === 0) {
    return "";
  }
  if (value < 20) {
    return ONES[value];
  }
  if (value < 100) {
    const tens = Math.floor(value / 10);
    const ones = value % 10;
    return ones ? `${TENS[tens]} ${ONES[ones]}` : TENS[tens];
  }
  const hundreds = Math.floor(value / 100);
  const remainder = value % 100;
  const tail = chunkToWords(remainder);
  return tail ? `${ONES[hundreds]} Hundred ${tail}` : `${ONES[hundreds]} Hundred`;
}

function integerToWords(value: number): string {
  if (value === 0) {
    return "Zero";
  }
  const scales = [
    { unit: 1_000_000_000, label: "Billion" },
    { unit: 1_000_000, label: "Million" },
    { unit: 1_000, label: "Thousand" },
    { unit: 1, label: "" }
  ];
  const parts: string[] = [];
  let remaining = value;
  for (const scale of scales) {
    const count = Math.floor(remaining / scale.unit);
    if (count > 0) {
      const words = chunkToWords(count);
      parts.push(scale.label ? `${words} ${scale.label}` : words);
      remaining %= scale.unit;
    }
  }
  return parts.join(" ");
}

/** Converts a GHS amount to words, e.g. "One Thousand Ghana Cedis and Fifty Pesewas only". */
export function amountFigureToWords(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) {
    return "";
  }
  const rounded = Math.round(amount * 100) / 100;
  const cedis = Math.floor(rounded);
  const pesewas = Math.round((rounded - cedis) * 100);

  let result = "";
  if (cedis === 0) {
    result = "Zero Ghana Cedis";
  } else {
    result = `${integerToWords(cedis)} Ghana Cedi${cedis === 1 ? "" : "s"}`;
  }

  if (pesewas > 0) {
    result += ` and ${integerToWords(pesewas)} Pesewa${pesewas === 1 ? "" : "s"}`;
  }

  return `${result} only`;
}
