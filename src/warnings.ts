export type WarningType =
  | "extra_values"
  | "missing_values"
  | "unrecognized_columns"
  | "missing_or_duplicate_ids"
  | "unrecognized_files"
  | "invalid_values"
  | "invalid_stop_sequence"
  | "variant_merge_different_short_names"
  | "variant_merge_different_shapes"
  | "variant_merge_identical_shapes";

export type WarningSeverity = "error" | "warning" | "info";
export type WarningScope = "archive" | "table" | "element";

export interface WarningDescription {
  id: WarningType;
  messageTemplate: string;
  severity: WarningSeverity;
  scope: WarningScope;
  parameters: readonly string[];
}

export const WARNING_DESCRIPTIONS: Readonly<Record<WarningType, WarningDescription>> = {
  extra_values: {
    id: "extra_values",
    messageTemplate: "{file}, row {row}: {count} extra value(s): {values}",
    severity: "warning",
    scope: "element",
    parameters: ["file", "row", "count", "values"],
  },
  missing_values: {
    id: "missing_values",
    messageTemplate: "{file}, row {row}: {count} missing value(s)",
    severity: "warning",
    scope: "element",
    parameters: ["file", "row", "count"],
  },
  unrecognized_columns: {
    id: "unrecognized_columns",
    messageTemplate: "{file}: unrecognized column \"{column}\"",
    severity: "warning",
    scope: "table",
    parameters: ["file", "column"],
  },
  missing_or_duplicate_ids: {
    id: "missing_or_duplicate_ids",
    messageTemplate: "{file}, row {row}: {issue} value for ID column \"{column}\"{idSuffix}",
    severity: "error",
    scope: "element",
    parameters: ["file", "row", "issue", "column", "idSuffix", "id"],
  },
  unrecognized_files: {
    id: "unrecognized_files",
    messageTemplate: "Unrecognized file in GTFS archive: {file}",
    severity: "warning",
    scope: "archive",
    parameters: ["file"],
  },
  invalid_values: {
    id: "invalid_values",
    messageTemplate: "{file}, row {row}: invalid value for \"{column}\": {value}",
    severity: "warning",
    scope: "element",
    parameters: ["file", "row", "column", "value"],
  },
  invalid_stop_sequence: {
    id: "invalid_stop_sequence",
    messageTemplate: "{file}, row {row}: trip {tripId} has stop_sequence {value}; values must be unique and form the range 1 to {stopCount}",
    severity: "warning",
    scope: "element",
    parameters: ["file", "row", "tripId", "value", "stopCount"],
  },
  variant_merge_different_short_names: {
    id: "variant_merge_different_short_names",
    messageTemplate: "Route {routeId}: variants merged despite different trip short names (trip_id/shape_id samples: {firstTripId}/{firstShapeId} and {secondTripId}/{secondShapeId})",
    severity: "warning",
    scope: "table",
    parameters: ["routeId", "first", "second", "firstTripId", "firstShapeId", "secondTripId", "secondShapeId"],
  },
  variant_merge_different_shapes: {
    id: "variant_merge_different_shapes",
    messageTemplate: "Route {routeId}: variants merged despite different shapes {firstShapeId} and {secondShapeId} (trips {firstTripId} and {secondTripId})",
    severity: "warning",
    scope: "table",
    parameters: ["routeId", "firstTripId", "firstShapeId", "secondTripId", "secondShapeId"],
  },
  variant_merge_identical_shapes: {
    id: "variant_merge_identical_shapes",
    messageTemplate: "Route {routeId}: variants merged with identical shapes {firstShapeId} and {secondShapeId} (trips {firstTripId} and {secondTripId})",
    severity: "info",
    scope: "table",
    parameters: ["routeId", "firstTripId", "firstShapeId", "secondTripId", "secondShapeId"],
  },
};

export interface GtfsWarning {
  type: WarningType;
  parameters: Record<string, unknown>;
  relatedObjectIds: string[];
  csvRowNumber?: number;
  message?: string;
}

export const WARNING_TYPES: readonly WarningType[] = [
  "extra_values",
  "missing_values",
  "unrecognized_columns",
  "missing_or_duplicate_ids",
  "unrecognized_files",
  "invalid_values",
  "invalid_stop_sequence",
  "variant_merge_different_short_names",
  "variant_merge_different_shapes",
  "variant_merge_identical_shapes",
];

export const WARNING_LABELS: Readonly<Record<WarningType, string>> = {
  extra_values: "Extra values in CSV rows",
  missing_values: "Missing values in CSV rows",
  unrecognized_columns: "Unrecognized CSV columns",
  missing_or_duplicate_ids: "Missing or duplicate IDs",
  unrecognized_files: "Unrecognized files",
  invalid_values: "Invalid field values",
  invalid_stop_sequence: "Invalid stop sequence",
  variant_merge_different_short_names: "Merged variants with different trip short names",
  variant_merge_different_shapes: "Merged variants with different shapes",
  variant_merge_identical_shapes: "Merged variants with identical shapes",
};

export class WarningCollector {
  private warnings: GtfsWarning[] = [];

  add(warning: GtfsWarning): void {
    this.warnings.push(warning);
  }

  clear(): void {
    this.warnings = [];
  }

  replace(warnings: readonly GtfsWarning[]): void {
    this.warnings = [...warnings];
  }

  get all(): readonly GtfsWarning[] {
    return this.warnings;
  }

  count(type: WarningType): number {
    return this.warnings.filter((warning) => warning.type === type).length;
  }

  forTypes(types: readonly WarningType[]): GtfsWarning[] {
    const selected = new Set(types);
    return this.warnings.filter((warning) => selected.has(warning.type));
  }
}
