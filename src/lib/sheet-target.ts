import { StoreError } from "./errors";

/** Kristian's original audit sheet. Every Sheets call refuses this id. */
export const ORIGINAL_SPREADSHEET_ID = "1xQE0oao0T77JufL29yTS2KqYfKT4XrozP4NcU0dfC3k";

/** Working copy. The phone app writes here only. */
export const COPY_SPREADSHEET_ID = "1M3Wl6w3ztjxx7XrF22H1I1fuCCjQdC1X124iixrt_8o";

export function writableSpreadsheetId(spreadsheetId: string = COPY_SPREADSHEET_ID): string {
  if (spreadsheetId === ORIGINAL_SPREADSHEET_ID) {
    throw new StoreError("The original Meds Audit Sheet is never edited.");
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(spreadsheetId)) {
    throw new StoreError("The spreadsheet id doesn't look right.");
  }
  return spreadsheetId;
}
