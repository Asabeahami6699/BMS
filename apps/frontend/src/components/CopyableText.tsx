import { useToast } from "./Toast";

type Props = {
  value: string;
  label?: string;
  className?: string;
};

export function CopyableText({ value, label = "Copied", className }: Props) {
  const { showToast } = useToast();

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      showToast(`${label} copied`, "success");
    } catch {
      showToast("Could not copy", "error");
    }
  }

  return (
    <button
      type="button"
      className={`copyable-text${className ? ` ${className}` : ""}`}
      onClick={() => void handleCopy()}
      title="Click to copy"
    >
      <span>{value}</span>
      <span className="copyable-text__icon" aria-hidden>
        ⧉
      </span>
    </button>
  );
}
