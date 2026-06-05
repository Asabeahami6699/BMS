import type { ReactNode } from "react";

type Props = {
  title: string;
  description: string;
  workflow?: string[];
  children?: ReactNode;
};

export function FeaturePlaceholderPage({ title, description, workflow, children }: Props) {
  return (
    <article className="card">
      <h2>{title}</h2>
      <p className="muted">{description}</p>
      {workflow && workflow.length > 0 ? (
        <div className="workflow-steps">
          <p className="muted">
            <strong>Workflow</strong>
          </p>
          <ol>
            {workflow.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      ) : null}
      {children ?? (
        <p className="muted">This screen is scaffolded and will be fully implemented in a future release.</p>
      )}
    </article>
  );
}
