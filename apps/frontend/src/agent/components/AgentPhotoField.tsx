import { useRef, useState } from "react";
import { CameraCaptureModal } from "../../components/CameraCaptureModal";
import { useToast } from "../../components/Toast";
import { compressImageDataUrl, isDataUrlWithinLimit } from "../../lib/imageCompress";

const MAX_UPLOAD_FILE_BYTES = 12 * 1024 * 1024;

type Props = {
  label: string;
  hint: string;
  photoUrl?: string;
  photoName?: string;
  onPhotoChange: (url: string | undefined, name?: string) => void;
  required?: boolean;
};

export function AgentPhotoField({
  label,
  hint,
  photoUrl,
  photoName,
  onPhotoChange,
  required
}: Props) {
  const { showToast } = useToast();
  const [cameraOpen, setCameraOpen] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  function readPhotoFile(file: File) {
    if (!file.type.startsWith("image/")) {
      showToast("Please choose an image file.", "error");
      return;
    }
    if (file.size > MAX_UPLOAD_FILE_BYTES) {
      showToast("Image must be 12 MB or smaller.", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      void (async () => {
        if (typeof reader.result !== "string") {
          return;
        }
        try {
          const compressed = await compressImageDataUrl(reader.result);
          if (!isDataUrlWithinLimit(compressed)) {
            showToast("Could not compress image enough. Try another photo.", "error");
            return;
          }
          onPhotoChange(compressed, file.name);
        } catch {
          showToast("Could not process image.", "error");
        }
      })();
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="field agent-photo-field">
      <span>
        {label}
        {required ? " *" : ""}
      </span>
      <p className="muted agent-photo-hint">{hint}</p>
      <div className="agent-photo-actions">
        <button type="button" className="button secondary" onClick={() => setCameraOpen(true)}>
          Take photo
        </button>
        <button type="button" className="button secondary" onClick={() => uploadInputRef.current?.click()}>
          Upload file
        </button>
      </div>
      <CameraCaptureModal
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(dataUrl, name) => onPhotoChange(dataUrl, name)}
      />
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        className="agent-photo-input"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) {
            readPhotoFile(file);
          }
        }}
      />
      {photoUrl ? (
        <div className="agent-photo-preview">
          <img src={photoUrl} alt={`${label} preview`} />
          <div className="agent-photo-preview-meta">
            <span className="muted">{photoName ?? "Photo attached"}</span>
            <button
              type="button"
              className="button-link button-link--danger"
              onClick={() => onPhotoChange(undefined)}
            >
              Remove
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
