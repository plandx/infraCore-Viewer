import { useRef, useState, useCallback } from "react";

interface Props {
  onFiles: (files: File[]) => void;
  loading: boolean;
}

export default function FileUpload({ onFiles, loading }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const files = Array.from(e.dataTransfer.files).filter((f) =>
        f.name.toLowerCase().endsWith(".ifc")
      );
      if (files.length > 0) onFiles(files);
    },
    [onFiles]
  );

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length > 0) onFiles(files);
      e.target.value = "";
    },
    [onFiles]
  );

  return (
    <div
      className={`file-upload ${dragging ? "dragging" : ""} ${loading ? "disabled" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => !loading && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".ifc"
        multiple
        style={{ display: "none" }}
        onChange={handleInput}
      />
      <div className="upload-icon">
        {loading ? (
          <span className="spinner" />
        ) : (
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        )}
      </div>
      <p className="upload-text">
        {loading
          ? "Lade IFC..."
          : dragging
            ? "Datei loslassen"
            : "IFC-Dateien ablegen oder klicken"}
      </p>
      <p className="upload-hint">IFC2X3 · IFC4 · IFC4X3 · Mehrere Modelle</p>
    </div>
  );
}
