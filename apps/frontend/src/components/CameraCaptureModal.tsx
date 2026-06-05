import { useEffect, useRef, useState } from "react";
import { MAX_PHOTO_BYTES } from "../lib/imageCompress";
import { useToast } from "./Toast";

const MAX_WIDTH = 1280;
const MAX_DATA_URL_CHARS = Math.ceil(MAX_PHOTO_BYTES * 1.37);

type Props = {
  open: boolean;
  onClose: () => void;
  onCapture: (dataUrl: string, fileName: string) => void;
};

function stopStream(stream: MediaStream | null) {
  if (!stream) {
    return;
  }
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function captureFrame(video: HTMLVideoElement): string | null {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) {
    return null;
  }
  const scale = Math.min(1, MAX_WIDTH / width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  let quality = 0.88;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  while (dataUrl.length > MAX_DATA_URL_CHARS && quality > 0.45) {
    quality -= 0.08;
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }
  return dataUrl;
}

export function CameraCaptureModal({ open, onClose, onCapture }: Props) {
  const { showToast } = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onCloseRef = useRef(onClose);
  const [starting, setStarting] = useState(false);
  const [ready, setReady] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");

  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) {
      stopStream(streamRef.current);
      streamRef.current = null;
      setReady(false);
      return;
    }

    let cancelled = false;
    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        showToast("Camera not supported on this device. Use Upload file instead.", "error");
        onCloseRef.current();
        return;
      }
      setStarting(true);
      stopStream(streamRef.current);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        });
        if (cancelled) {
          stopStream(stream);
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
          setReady(true);
        }
      } catch {
        showToast("Could not access camera. Allow permission or use Upload file.", "error");
        onCloseRef.current();
      } finally {
        if (!cancelled) {
          setStarting(false);
        }
      }
    }

    void startCamera();
    return () => {
      cancelled = true;
      stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, [open, facingMode, showToast]);

  function handleCapture() {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    const dataUrl = captureFrame(video);
    if (!dataUrl) {
      showToast("Could not capture photo. Try again.", "error");
      return;
    }
    if (dataUrl.length > MAX_DATA_URL_CHARS) {
      showToast("Photo is too large. Move closer or use Upload file.", "error");
      return;
    }
    onCapture(dataUrl, `camera-${Date.now()}.jpg`);
    onClose();
  }

  function handleSwitchCamera() {
    setFacingMode((prev) => (prev === "environment" ? "user" : "environment"));
    setReady(false);
  }

  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop modal-backdrop--stacked" role="presentation" onClick={onClose}>
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="camera-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2 id="camera-modal-title">Take photo</h2>
            <p className="muted modal-subtitle">Live camera preview. Tap Capture when ready.</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="modal-body">
          <div className="camera-capture-wrap">
            <video
              ref={videoRef}
              className="camera-capture-video"
              playsInline
              muted
              autoPlay
              aria-label="Camera preview"
            />
            {starting ? <p className="muted camera-capture-status">Starting camera…</p> : null}
            {!starting && ready ? <p className="muted camera-capture-status">Camera active</p> : null}
          </div>
        </div>
        <footer className="modal-footer">
          <button type="button" className="button secondary" onClick={handleSwitchCamera} disabled={starting}>
            Flip camera
          </button>
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button" onClick={handleCapture} disabled={!ready || starting}>
            Capture
          </button>
        </footer>
      </div>
    </div>
  );
}
