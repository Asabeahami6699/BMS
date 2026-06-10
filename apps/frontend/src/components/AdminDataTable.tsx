import type { ReactNode } from "react";

export type AdminTableColumn<T> = {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
  className?: string;
};

type Props<T> = {
  columns: AdminTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  emptyMessage?: string;
  actions?: (row: T) => ReactNode;
  toolbar?: ReactNode;
  variant?: "default" | "desk";
  title?: string;
  subtitle?: string;
};

export function filterRowsBySearch<T extends Record<string, unknown>>(
  rows: T[],
  search: string,
  keys: (keyof T)[]
): T[] {
  const q = search.trim().toLowerCase();
  if (!q) {
    return rows;
  }
  return rows.filter((row) =>
    keys.some((key) => String(row[key] ?? "").toLowerCase().includes(q))
  );
}

export function AdminDataTable<T>({
  columns,
  rows,
  rowKey,
  search,
  onSearchChange,
  searchPlaceholder = "Search…",
  emptyMessage = "No records found.",
  actions,
  toolbar,
  variant = "default",
  title,
  subtitle
}: Props<T>) {
  const isDesk = variant === "desk";
  const table = (
    <div className={`admin-table-wrap${isDesk ? " desk-data-table__body" : ""}`}>
      <div className="admin-table-toolbar">
        <label className="admin-table-search">
          <span className="sr-only">Search</span>
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
          />
        </label>
        {toolbar}
      </div>
      <div className={`admin-table-scroll${isDesk ? " desk-data-table__scroll" : ""}`}>
        <table className={`admin-table${isDesk ? " desk-data-table__grid" : ""}`}>
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} className={col.className}>
                  {col.label}
                </th>
              ))}
              {actions ? <th className="admin-table-actions-col">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (actions ? 1 : 0)} className="admin-table-empty">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={rowKey(row)}>
                  {columns.map((col) => (
                    <td key={col.key} className={col.className}>
                      {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? "—")}
                    </td>
                  ))}
                  {actions ? <td className="admin-table-actions">{actions(row)}</td> : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  if (!isDesk) {
    return table;
  }

  return (
    <section className="desk-data-table card">
      {title ? (
        <header className="desk-data-table__head">
          <h3>{title}</h3>
          {subtitle ? <p className="muted">{subtitle}</p> : null}
        </header>
      ) : null}
      {table}
    </section>
  );
}
