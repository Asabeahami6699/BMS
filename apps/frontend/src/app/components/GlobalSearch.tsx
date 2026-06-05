import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Customer, UserRecord } from "../api";
import { listUsers, searchCustomers } from "../api";

type Props = {
  canSearchCustomers: boolean;
  canSearchUsers: boolean;
};

type SearchHit =
  | { kind: "customer"; id: string; title: string; subtitle: string }
  | { kind: "user"; id: string; title: string; subtitle: string };

export function GlobalSearch({ canSearchCustomers, canSearchUsers }: Props) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const usersCacheRef = useRef<UserRecord[] | null>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setError(null);
      setLoading(false);
      return;
    }

    if (!canSearchCustomers && !canSearchUsers) {
      setHits([]);
      return;
    }

    const timer = setTimeout(() => {
      void (async () => {
        setLoading(true);
        setError(null);
        try {
          const results: SearchHit[] = [];

          if (canSearchCustomers) {
            const customers = await searchCustomers(q);
            for (const c of customers.slice(0, 8)) {
              results.push({
                kind: "customer",
                id: c.id,
                title: c.fullName,
                subtitle: [c.phone, c.accountNumber, c.status].filter(Boolean).join(" · ")
              });
            }
          }

          if (canSearchUsers) {
            if (!usersCacheRef.current) {
              usersCacheRef.current = await listUsers();
            }
            const lower = q.toLowerCase();
            for (const u of usersCacheRef.current) {
              const hay = [u.fullName, u.email, u.role, u.branchId].filter(Boolean).join(" ").toLowerCase();
              if (!hay.includes(lower)) {
                continue;
              }
              results.push({
                kind: "user",
                id: u.userId,
                title: u.fullName ?? u.email ?? u.userId,
                subtitle: `${u.role.replace(/_/g, " ")}${u.email ? ` · ${u.email}` : ""}`
              });
              if (results.filter((r) => r.kind === "user").length >= 5) {
                break;
              }
            }
          }

          setHits(results.slice(0, 12));
          setOpen(true);
        } catch (err) {
          setHits([]);
          setError(err instanceof Error ? err.message : "Search failed");
          setOpen(true);
        } finally {
          setLoading(false);
        }
      })();
    }, 280);

    return () => clearTimeout(timer);
  }, [query, canSearchCustomers, canSearchUsers]);

  function goTo(hit: SearchHit) {
    setOpen(false);
    setQuery("");
    if (hit.kind === "customer") {
      navigate(`/app/susu/customers?q=${encodeURIComponent(hit.title)}`);
      return;
    }
    navigate("/app/settings/users");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && hits[0]) {
      e.preventDefault();
      goTo(hits[0]);
    }
    if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const disabled = !canSearchCustomers && !canSearchUsers;

  return (
    <div className="dash-search-wrap global-search" ref={wrapRef}>
      <span className="dash-search-icon" aria-hidden>
        ⌕
      </span>
      <input
        className="dash-search"
        type="search"
        value={query}
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value);
          if (e.target.value.trim().length >= 2) {
            setOpen(true);
          }
        }}
        onFocus={() => {
          if (query.trim().length >= 2) {
            setOpen(true);
          }
        }}
        onKeyDown={onKeyDown}
        placeholder={
          disabled
            ? "Search not available for your role"
            : canSearchCustomers && canSearchUsers
              ? "Search customers, users…"
              : canSearchCustomers
                ? "Search customers by name, phone, account…"
                : "Search users…"
        }
        aria-label="Search workspace"
        aria-expanded={open}
        aria-controls="global-search-results"
        autoComplete="off"
      />
      {open && (query.trim().length >= 2 || error) ? (
        <div id="global-search-results" className="global-search__panel" role="listbox">
          {loading ? <p className="global-search__meta muted">Searching…</p> : null}
          {error ? <p className="global-search__meta global-search__error">{error}</p> : null}
          {!loading && !error && hits.length === 0 ? (
            <p className="global-search__meta muted">No matches for “{query.trim()}”.</p>
          ) : null}
          {hits.map((hit) => (
            <button
              key={`${hit.kind}-${hit.id}`}
              type="button"
              className="global-search__hit"
              role="option"
              onClick={() => goTo(hit)}
            >
              <span className="global-search__hit-kind">{hit.kind === "customer" ? "Customer" : "User"}</span>
              <span className="global-search__hit-title">{hit.title}</span>
              <span className="global-search__hit-sub muted">{hit.subtitle}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
