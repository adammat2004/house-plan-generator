"use client";

import { useEffect, useState } from "react";
import { shouldRemind, snoozeReminder } from "@/persistence/backupReminder";
import { useSaveStatus } from "../../state/saveStatus";
import { exportProjectFile } from "./exports";

/** A quiet, dismissible nudge to download a backup, shown after a good amount of work. */
export function BackupReminder() {
  const { status } = useSaveStatus();
  const [shown, setShown] = useState(false);
  // Re-check after each save; the reminder logic decides whether it is time.
  useEffect(() => {
    if (status.state === "saved") setShown(shouldRemind());
  }, [status]);
  if (!shown) return null;
  const later = () => {
    snoozeReminder();
    setShown(false);
  };
  return (
    <div className="backup-reminder" role="region" aria-label="Backup reminder" data-testid="backup-reminder">
      <p>Your designs are saved only on this device. Download a backup so you never lose your house.</p>
      <div className="backup-reminder-actions">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => {
            exportProjectFile();
            setShown(false);
          }}
          data-testid="backup-reminder-download"
        >
          Download backup
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={later} data-testid="backup-reminder-dismiss">
          Not now
        </button>
      </div>
    </div>
  );
}
