import { downloadHtmlDocument, printHtmlDocument } from "./printHtml";
import { buildDailyTallySheetHtml, type DailyTallySheetOptions } from "./dailyTallySheetDocument";

function todayLabel(): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit"
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function withDefaults(options: DailyTallySheetOptions): DailyTallySheetOptions {
  return {
    ...options,
    rowCount: options.rowCount ?? 40,
    dateLabel: options.dateLabel ?? todayLabel()
  };
}

export function printDailyTallySheet(options: DailyTallySheetOptions = {}): void {
  printHtmlDocument(
    buildDailyTallySheetHtml(withDefaults(options)),
    "Pop-up blocked. Allow pop-ups to print the tally sheet."
  );
}

export function downloadDailyTallySheet(options: DailyTallySheetOptions = {}): void {
  downloadHtmlDocument(buildDailyTallySheetHtml(withDefaults(options)), "daily-tally-sheet.html");
}
