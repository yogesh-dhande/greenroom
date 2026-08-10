"use client";

import { useCallback, useEffect, useState } from "react";
import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";

export function FileExportControls({ formId, total }: { formId: string; total: number }) {
  const [selected, setSelected] = useState(total);

  const recount = useCallback(() => {
    setSelected(document.querySelectorAll<HTMLInputElement>(`input[name="file"][form="${formId}"]:checked`).length);
  }, [formId]);

  useEffect(() => {
    document.addEventListener("change", recount);
    return () => document.removeEventListener("change", recount);
  }, [formId, recount]);

  function setAll(checked: boolean) {
    for (const input of document.querySelectorAll<HTMLInputElement>(`input[name="file"][form="${formId}"]`)) {
      input.checked = checked;
    }
    recount();
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span className="text-sm text-muted-foreground" aria-live="polite">
        {selected} of {total} selected
      </span>
      <Button type="button" variant="ghost" size="sm" onClick={() => setAll(true)}>
        Select all
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setAll(false)}>
        Select none
      </Button>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        Group folders by
        <NativeSelect name="group" form={formId} defaultValue="speaker" aria-label="Group folders by">
          <option value="speaker">Speaker</option>
          <option value="session">Session</option>
          <option value="flat">No folders</option>
        </NativeSelect>
      </label>
      <Button type="submit" form={formId} disabled={selected === 0}>
        <DownloadIcon className="size-3.5" />
        Download selected
      </Button>
    </div>
  );
}
