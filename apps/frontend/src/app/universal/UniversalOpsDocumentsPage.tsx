import { UniversalOpsFeatureGrid, UniversalOpsShell } from "./UniversalOpsShell";

type Props = { displayName?: string };

const DOC_TYPES = [
  "HR policies",
  "Staff handbook",
  "Operations manual",
  "Compliance manual",
  "AML guidelines",
  "SOP documents",
  "Circulars",
  "Employment contracts"
];

export function UniversalOpsDocumentsPage({ displayName }: Props) {
  return (
    <UniversalOpsShell
      title="Documents Center"
      subtitle="Policies, handbooks, SOPs, and circulars for everyday reference."
      displayName={displayName}
    >
      <section className="card">
        <label className="field">
          <span>Search documents</span>
          <input type="search" placeholder="Search by title, category, or keyword…" />
        </label>
      </section>

      <section className="card">
        <h3>Document library</h3>
        <ul className="universal-ops__tag-list">
          {DOC_TYPES.map((doc) => (
            <li key={doc}>{doc}</li>
          ))}
        </ul>
      </section>

      <UniversalOpsFeatureGrid
        items={[
          { title: "Download", description: "Save PDF and office documents locally." },
          { title: "Version history", description: "See when policies were last revised." },
          { title: "Recently uploaded", description: "New circulars and compliance updates." }
        ]}
      />
    </UniversalOpsShell>
  );
}
