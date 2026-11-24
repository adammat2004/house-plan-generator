"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { readProjectFile } from "@/persistence/jsonFile";
import { createProjectFromImport, editorHref } from "../library";

/** One click from a backup file to the project open in the editor; a bad file gets a plain-language message. */
export function OpenBackup() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = async (file: File) => {
    setError(null);
    setBusy(true);
    const loaded = await readProjectFile(file);
    if (!loaded.ok) {
      setBusy(false);
      setError(`That file isn't a HomeDesign backup we can open. ${loaded.issues[0]?.message ?? ""}`.trim());
      return;
    }
    try {
      const id = await createProjectFromImport(loaded.project, loaded.project.name);
      router.push(editorHref(id));
    } catch (e) {
      setBusy(false);
      setError(`The backup couldn't be saved on this device: ${(e as Error).message || "unknown problem"}`);
    }
  };

  return (
    <div className="open-backup">
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => input.current?.click()} data-testid="open-backup">
        Open backup
      </button>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        data-testid="open-backup-input"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (file) void open(file);
        }}
      />
      {error && (
        <p className="field-error" role="alert" data-testid="open-backup-error">
          {error}
        </p>
      )}
    </div>
  );
}
