import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { SITE_MANUAL_DEPARTMENTS, type SiteManualDepartment } from "@bms/shared";
import { useToast } from "../components/Toast";
import { useSiteManualStore } from "./stores/siteManualStore";

export function SiteManualPage() {
  const { showToast } = useToast();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [activeDept, setActiveDept] = useState<SiteManualDepartment | "all">("all");

  const { articles, loading, error, hydrate, lastFetchedAt } = useSiteManualStore(
    useShallow((s) => ({
      articles: s.articles,
      loading: s.loading,
      error: s.error,
      hydrate: s.hydrate,
      lastFetchedAt: s.lastFetchedAt
    }))
  );

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 200);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (error) {
      showToast(error, "error");
    }
  }, [error, showToast]);

  const visible = useMemo(() => {
    const q = debounced.toLowerCase();
    if (!q) {
      return articles;
    }
    return articles.filter((article) => {
      const hay = [
        article.title,
        article.howTo,
        ...article.keywords,
        ...article.body,
        article.department
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [articles, debounced]);

  const grouped = useMemo(() => {
    const map = new Map<SiteManualDepartment, typeof visible>();
    for (const article of visible) {
      if (activeDept !== "all" && article.department !== activeDept) {
        continue;
      }
      const list = map.get(article.department) ?? [];
      list.push(article);
      map.set(article.department, list);
    }
    return SITE_MANUAL_DEPARTMENTS.filter((d) => map.has(d.id)).map((d) => ({
      ...d,
      articles: map.get(d.id) ?? []
    }));
  }, [visible, activeDept]);

  const howToHints = useMemo(() => {
    if (!debounced) {
      return visible.filter((a) => a.howTo.toLowerCase().startsWith("how to")).slice(0, 8);
    }
    return visible.slice(0, 12);
  }, [visible, debounced]);

  const showInitialLoading = loading && lastFetchedAt == null;

  return (
    <article className="card site-manual">
      <h2>Site manual</h2>
      <p className="muted">
        How-to guides for your subscribed products, grouped by department. Search by product name
        or keyword (e.g. Susu, loan, disburse, SMS).
      </p>

      <label className="field site-manual__search">
        <span>Search how-to</span>
        <input
          type="search"
          placeholder="How to… product, keyword, or feature"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </label>

      {howToHints.length > 0 ? (
        <div className="site-manual__howto-headers" aria-label="How-to suggestions">
          {howToHints.map((article) => (
            <button
              key={`hint-${article.id}`}
              type="button"
              className="site-manual__howto-chip"
              onClick={() => {
                setQuery(article.howTo);
                setActiveDept(article.department);
                document.getElementById(`manual-${article.id}`)?.scrollIntoView({
                  behavior: "smooth",
                  block: "start"
                });
              }}
            >
              {article.howTo}
            </button>
          ))}
        </div>
      ) : null}

      <div className="site-manual__dept-tabs" role="tablist" aria-label="Departments">
        <button
          type="button"
          role="tab"
          className={activeDept === "all" ? "is-active" : undefined}
          aria-selected={activeDept === "all"}
          onClick={() => setActiveDept("all")}
        >
          All
        </button>
        {SITE_MANUAL_DEPARTMENTS.map((dept) => (
          <button
            key={dept.id}
            type="button"
            role="tab"
            className={activeDept === dept.id ? "is-active" : undefined}
            aria-selected={activeDept === dept.id}
            onClick={() => setActiveDept(dept.id)}
          >
            {dept.label}
          </button>
        ))}
      </div>

      {showInitialLoading ? <p className="muted">Loading…</p> : null}
      {!showInitialLoading && grouped.length === 0 ? (
        <p className="muted">No guides match this search for your subscribed products.</p>
      ) : null}

      {grouped.map((dept) => (
        <section key={dept.id} className="site-manual__dept">
          <header>
            <h3>{dept.label}</h3>
            <p className="muted">{dept.description}</p>
          </header>
          <ul className="site-manual__list">
            {dept.articles.map((article) => (
              <li key={article.id} id={`manual-${article.id}`} className="site-manual__article">
                <h4>{article.title}</h4>
                <p className="site-manual__howto">{article.howTo}</p>
                <ol>
                  {article.body.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ol>
                {article.keywords.length > 0 ? (
                  <p className="muted site-manual__keywords">
                    Keywords: {article.keywords.join(", ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </article>
  );
}
