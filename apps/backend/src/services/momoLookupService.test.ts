import { describe, expect, it } from "vitest";
import {
  detectGhanaMomoNetwork,
  matchGhanaBankByName,
  normalizeGhanaMomoPhone,
  parseMomoNetworkCode,
  type GhanaBankOption
} from "./momoLookupService.js";

const SAMPLE_BANKS: GhanaBankOption[] = [
  { code: "GH010100", name: "GCB Bank Limited" },
  { code: "GH130100", name: "Ecobank Ghana" },
  { code: "GH240100", name: "Fidelity Bank Ghana Limited" },
  { code: "GH030100", name: "Absa Bank Ghana Ltd" },
  { code: "GH190100", name: "Stanbic Bank Ghana" },
  { code: "GH120100", name: "Zenith Bank Ghana" },
  { code: "GH140100", name: "CAL Bank Limited" },
  { code: "GH060100", name: "United Bank for Africa (Ghana) Ltd" },
  { code: "GH280100", name: "Access Bank (Ghana) Plc" },
  { code: "GH080100", name: "Agricultural Development Bank" }
];

describe("momoLookupService helpers", () => {
  it("normalizes Ghana MoMo phone numbers", () => {
    expect(normalizeGhanaMomoPhone("0244123456")).toBe("0244123456");
    expect(normalizeGhanaMomoPhone("233244123456")).toBe("0244123456");
    expect(normalizeGhanaMomoPhone("+233 50 123 4567")).toBe("0501234567");
    expect(normalizeGhanaMomoPhone("244123456")).toBe("0244123456");
    expect(normalizeGhanaMomoPhone("12345")).toBeNull();
    expect(normalizeGhanaMomoPhone("0101234567")).toBeNull();
  });

  it("detects Ghana MoMo network from prefix", () => {
    expect(detectGhanaMomoNetwork("0244123456")).toBe("MTN");
    expect(detectGhanaMomoNetwork("0591234567")).toBe("MTN");
    expect(detectGhanaMomoNetwork("0201234567")).toBe("VOD");
    expect(detectGhanaMomoNetwork("0501234567")).toBe("VOD");
    expect(detectGhanaMomoNetwork("0271234567")).toBe("ATL");
    expect(detectGhanaMomoNetwork("0561234567")).toBe("ATL");
  });

  it("parses MoMo network names and codes", () => {
    expect(parseMomoNetworkCode("MTN")).toBe("MTN");
    expect(parseMomoNetworkCode("MTN MoMo")).toBe("MTN");
    expect(parseMomoNetworkCode("Telecel Cash")).toBe("VOD");
    expect(parseMomoNetworkCode("Vodafone")).toBe("VOD");
    expect(parseMomoNetworkCode("AT Money")).toBe("ATL");
    expect(parseMomoNetworkCode("AirtelTigo")).toBe("ATL");
    expect(parseMomoNetworkCode("Ecobank")).toBeNull();
  });

  it("matches agency banking labels to Paystack Ghana banks", () => {
    expect(matchGhanaBankByName("GCB", SAMPLE_BANKS)?.code).toBe("GH010100");
    expect(matchGhanaBankByName("GCB Bank", SAMPLE_BANKS)?.code).toBe("GH010100");
    expect(matchGhanaBankByName("Ecobank", SAMPLE_BANKS)?.code).toBe("GH130100");
    expect(matchGhanaBankByName("Fidelity", SAMPLE_BANKS)?.code).toBe("GH240100");
    expect(matchGhanaBankByName("Absa", SAMPLE_BANKS)?.code).toBe("GH030100");
    expect(matchGhanaBankByName("CalBank", SAMPLE_BANKS)?.code).toBe("GH140100");
    expect(matchGhanaBankByName("UBA", SAMPLE_BANKS)?.code).toBe("GH060100");
    expect(matchGhanaBankByName("Access", SAMPLE_BANKS)?.code).toBe("GH280100");
    expect(matchGhanaBankByName("ADB", SAMPLE_BANKS)?.code).toBe("GH080100");
    expect(matchGhanaBankByName("Other", SAMPLE_BANKS)).toBeNull();
  });
});
