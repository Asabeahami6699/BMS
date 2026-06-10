import type { ReactNode } from "react";

export type DeskSummaryColumn<T> = {
  key: string;
  label: string;
  align?: "left" | "right";
  render?: (row: T) => ReactNode;
  className?: string;
};

type Props<T> = {
  title: string;
  subtitle?: string;
  columns: DeskSummaryColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyMessage?: string;
};

export function DeskSummaryTable<T>({
  title,
  subtitle,
  columns,
  rows,
  rowKey,
  emptyMessage = "No records."
}: Props<T>) {
  return (
    <section className="desk-data-table card">
      <header className="desk-data-table__head">
        <h3>{title}</h3>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
      </header>
      <div className="desk-data-table__scroll">
        <table className="desk-data-table__grid">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`${col.align === "right" ? "desk-data-table__num" : ""} ${col.className ?? ""}`.trim()}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="desk-data-table__empty">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={rowKey(row)}>
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`${col.align === "right" ? "desk-data-table__num" : ""} ${col.className ?? ""}`.trim()}
                    >
                      {col.render
                        ? col.render(row)
                        : String((row as Record<string, unknown>)[col.key] ?? "—")}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
