export type ViewState =
  | { type: "table"; table: string; itemIndex: number; search: string; filter?: string; filterKind?: string }
  | { type: "route"; routeId: string }
  | { type: "stop"; stopId: string }
  | { type: "warnings"; selectedTypes: string[]; page: number; pageSize: number }
  | { type: "map"; mode: "stops" | "routes" | "route"; routeId?: string; variantIndex?: number | "all" };

export const DEFAULT_VIEW_STATE: ViewState = {
  type: "table",
  table: "",
  itemIndex: 0,
  search: "",
};

export class ViewHistory {
  private entries: ViewState[] = [{ ...DEFAULT_VIEW_STATE }];
  private cursor = 0;
  readonly maxEntries = 16;

  push(state: ViewState): void {
    this.entries = this.entries.slice(0, this.cursor + 1);
    const current = this.entries[this.cursor];
    if (current?.type === state.type) {
      this.entries[this.cursor] = state;
      return;
    }
    this.entries.push(state);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
    this.cursor = this.entries.length - 1;
  }

  back(): ViewState | undefined {
    if (this.cursor > 0) {
      this.cursor--;
      return this.entries[this.cursor];
    }
    return undefined;
  }

  forward(): ViewState | undefined {
    if (this.cursor + 1 < this.entries.length) {
      this.cursor++;
      return this.entries[this.cursor];
    }
    return undefined;
  }

  get canGoBack(): boolean {
    return this.cursor > 0;
  }

  get canGoForward(): boolean {
    return this.cursor + 1 < this.entries.length;
  }

  get states(): readonly ViewState[] {
    return this.entries;
  }

  get current(): ViewState {
    return this.entries[this.cursor];
  }

  get currentIndex(): number {
    return this.cursor;
  }

  clear(initial: ViewState = DEFAULT_VIEW_STATE): void {
    this.entries = [{ ...initial }];
    this.cursor = 0;
  }

  select(index: number): ViewState | undefined {
    if (!Number.isInteger(index) || index < 0 || index >= this.entries.length) return undefined;
    this.cursor = index;
    return this.entries[index];
  }
}

export { ViewHistory as BackHistory };
