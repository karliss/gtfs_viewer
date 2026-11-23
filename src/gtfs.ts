import { unzipSync } from "fflate";
import Papa from "papaparse";

export interface GtfsTable {
  name: string;
  columns: string[];
  rows: string[][];
}

export interface GtfsFeed {
  tables: GtfsTable[];
}

export function loadGtfs(data: Uint8Array): GtfsFeed {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data);
  } catch {
    throw new Error("Could not read the ZIP file. Make sure it is a valid, unencrypted ZIP archive.");
  }

  const tables: GtfsTable[] = [];
  const names = new Set<string>();
  const decoder = new TextDecoder("utf-8", { fatal: true });

  for (const [path, bytes] of Object.entries(files)) {
    const parts = path.split("/");
    const name = parts[parts.length - 1];
    if (!name.toLowerCase().endsWith(".txt") || name.startsWith("._") || parts.includes("__MACOSX")) {
      continue;
    }

    const key = name.toLowerCase();
    if (names.has(key)) {
      throw new Error(`The ZIP contains multiple files named ${name}.`);
    }
    names.add(key);

    let text: string;
    try {
      text = decoder.decode(bytes);
    } catch {
      throw new Error(`${name} is not valid UTF-8.`);
    }

    const parsed = Papa.parse<string[]>(text, {
      delimiter: ",",
      skipEmptyLines: true,
    });
    if (parsed.errors.length > 0) {
      throw new Error(`Could not parse ${name}: ${parsed.errors[0].message}`);
    }

    const [columns, ...rows] = parsed.data;
    if (!columns || columns.some((column) => column.trim() === "")) {
      throw new Error(`${name} must have a non-empty header row.`);
    }
    if (new Set(columns).size !== columns.length) {
      throw new Error(`${name} contains duplicate column names.`);
    }
    const invalidRow = rows.findIndex((row) => row.length !== columns.length);
    if (invalidRow !== -1) {
      throw new Error(`${name} has a different number of fields than its header in data row ${invalidRow + 1}.`);
    }
    tables.push({ name, columns, rows });
  }

  if (tables.length === 0) {
    throw new Error("The ZIP does not contain any GTFS .txt files.");
  }

  tables.sort((a, b) => a.name.localeCompare(b.name));
  return { tables };
}
