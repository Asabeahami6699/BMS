import { downloadHtmlDocument, printHtmlDocument } from "./printHtml";
import {
  buildWalkInDepositSlipSheetHtml,
  type WalkInDepositSlipOptions
} from "./walkInDepositSlipDocument";

export function printWalkInDepositSlipSheet(options: WalkInDepositSlipOptions = {}): void {
  printHtmlDocument(
    buildWalkInDepositSlipSheetHtml(options),
    "Pop-up blocked. Allow pop-ups to print the walk-in deposit slips."
  );
}

export function downloadWalkInDepositSlipSheet(options: WalkInDepositSlipOptions = {}): void {
  downloadHtmlDocument(
    buildWalkInDepositSlipSheetHtml(options),
    "walk-in-deposit-slips-6-up-a4.html"
  );
}
