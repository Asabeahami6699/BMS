import { FormEvent, useMemo, useState } from "react";
import { DOCUMENT_CATEGORIES } from "@bms/shared";
import { useShallow } from "zustand/react/shallow";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../../components/Toast";
import { useUniversalOpsLiveSync } from "../hooks/useUniversalOpsLiveSync";
import { useUniversalOpsStore } from "../stores/universalOpsStore";
import { UniversalOpsQuickLinks, UniversalOpsShell } from "./UniversalOpsShell";

type Props = { displayName?: string };

export function UniversalOpsDocumentsPage({ displayName }: Props) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const canUpload = user?.permissions?.includes("users.update");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>(DOCUMENT_CATEGORIES[0]);
  const [fileUrl, setFileUrl] = useState("");
  const [version, setVersion] = useState("1.0");
  useUniversalOpsLiveSync({ scope: "documents" });

  const { documents, loading, actionBusy, uploadDocument, refreshDocuments } = useUniversalOpsStore(
    useShallow((s) => ({
      documents: s.documents,
      loading: s.documentsLoading,
      actionBusy: s.actionBusy,
      uploadDocument: s.uploadDocument,
      refreshDocuments: s.refreshDocuments
    }))
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      return documents;
    }
    return documents.filter(
      (d) => d.title.toLowerCase().includes(q) || d.category.toLowerCase().includes(q)
    );
  }, [documents, search]);

  async function handleUpload(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      return;
    }
    try {
      await uploadDocument({
        title: title.trim(),
        category,
        fileUrl: fileUrl.trim() || undefined,
        version: version.trim() || "1.0"
      });
      showToast("Document added", "success");
      setShowForm(false);
      setTitle("");
      setFileUrl("");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to upload", "error");
    }
  }

  return (
    <UniversalOpsShell
      title="Documents Center"
      subtitle="Policies, handbooks, SOPs, and circulars for everyday reference."
      displayName={displayName}
      actions={
        <div className="universal-ops__actions">
          {canUpload ? (
            <button type="button" className="button primary" onClick={() => setShowForm((v) => !v)}>
              {showForm ? "Close" : "Add document"}
            </button>
          ) : null}
          <button type="button" className="button secondary" onClick={() => void refreshDocuments()}>
            Refresh
          </button>
        </div>
      }
    >
      <section className="card">
        <label className="field">
          <span>Search documents</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title, category, or keyword…"
          />
        </label>
      </section>

      {showForm && canUpload ? (
        <form className="card stack-form" onSubmit={handleUpload}>
          <h3>Add document</h3>
          <label className="field">
            <span>Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <label className="field">
            <span>Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {DOCUMENT_CATEGORIES.map((doc) => (
                <option key={doc} value={doc}>
                  {doc}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>File URL or link</span>
            <input value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} placeholder="https://… or paste link" />
          </label>
          <label className="field">
            <span>Version</span>
            <input value={version} onChange={(e) => setVersion(e.target.value)} />
          </label>
          <button type="submit" className="button primary" disabled={actionBusy}>
            {actionBusy ? "Saving…" : "Save document"}
          </button>
        </form>
      ) : null}

      <section className="card">
        <h3>Document library</h3>
        {loading && documents.length === 0 ? <p className="muted">Loading…</p> : null}
        {!loading && filtered.length === 0 ? <p className="muted">No documents match your search.</p> : null}
        <ul className="universal-ops__doc-list">
          {filtered.map((doc) => (
            <li key={doc.id} className="universal-ops__doc-item">
              <div>
                <strong>{doc.title}</strong>
                <p className="muted">
                  {doc.category} · v{doc.version} · {new Date(doc.createdAt).toLocaleDateString()}
                </p>
              </div>
              {doc.fileUrl ? (
                <a className="button secondary" href={doc.fileUrl} target="_blank" rel="noreferrer">
                  Open
                </a>
              ) : (
                <span className="muted">No file</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <UniversalOpsQuickLinks excludePath="operations/documents" />
    </UniversalOpsShell>
  );
}
