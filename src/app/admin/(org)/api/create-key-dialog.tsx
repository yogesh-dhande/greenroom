"use client";

import { useState } from "react";
import { KeyRoundIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { createApiCredential } from "./actions";
import { CopyButton } from "./copy-button";
import type { ApiEventOption, ApiKeyPermission } from "./types";

type EventAccess = "all" | "selected";

const DEFAULT_EXPIRY = "90";

export function CreateKeyDialog({ events }: { events: ApiEventOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [permission, setPermission] = useState<ApiKeyPermission>("read");
  const [eventAccess, setEventAccess] = useState<EventAccess>("all");
  const [eventIds, setEventIds] = useState<string[]>([]);
  const [expiresInDays, setExpiresInDays] = useState(DEFAULT_EXPIRY);
  const [secret, setSecret] = useState<string | null>(null);
  const [createdLabel, setCreatedLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setLabel("");
    setPermission("read");
    setEventAccess("all");
    setEventIds([]);
    setExpiresInDays(DEFAULT_EXPIRY);
    setSecret(null);
    setCreatedLabel("");
    setError(null);
    setSubmitting(false);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await createApiCredential({
        label,
        permission,
        eventAccess,
        eventIds,
        expiresInDays: Number(expiresInDays) as 30 | 90 | 365,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }

      setCreatedLabel(result.data.credential.label);
      setSecret(result.data.secret);
      toast.success("API key created");
      router.refresh();
    } catch {
      setError("Couldn't create the key — try again");
    } finally {
      setSubmitting(false);
    }
  }

  function toggleEvent(eventId: string, checked: boolean) {
    setEventIds((current) =>
      checked
        ? current.includes(eventId)
          ? current
          : [...current, eventId]
        : current.filter((id) => id !== eventId),
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <KeyRoundIcon aria-hidden />
          Create API key
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-xl">
        {secret ? (
          <>
            <DialogHeader>
              <DialogTitle>Save your API key</DialogTitle>
              <DialogDescription>
                {createdLabel} is ready. This is the only time Greenroom will show the full key.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-2">
              <Label htmlFor="new-api-key">API key</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="new-api-key"
                  value={secret}
                  readOnly
                  className="font-mono text-xs"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <CopyButton value={secret} />
              </div>
              <p className="rounded-md border border-warning bg-warning/10 p-3 text-sm text-foreground">
                Copy this key now and store it somewhere secure. Closing this window permanently
                hides the secret; if you lose it, revoke it and create another key.
              </p>
            </div>

            <DialogFooter>
              <Button type="button" onClick={() => setOpen(false)}>
                I&apos;ve saved the key
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Create API key</DialogTitle>
              <DialogDescription>
                Give an integration only the permissions and events it needs. Keys expire
                automatically and can be revoked at any time.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={submit} className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="api-key-label">Label</Label>
                <Input
                  id="api-key-label"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="Agenda automation"
                  maxLength={80}
                  required
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  Name the service or workflow that will use this key.
                </p>
              </div>

              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium text-foreground">Permission</legend>
                <label className="flex cursor-pointer gap-3 rounded-md border border-border p-3 has-checked:border-primary has-checked:bg-accent/50">
                  <input
                    type="radio"
                    name="permission"
                    value="read"
                    checked={permission === "read"}
                    onChange={() => setPermission("read")}
                    className="mt-0.5 accent-primary"
                  />
                  <span>
                    <span className="block text-sm font-medium text-foreground">Read-only</span>
                    <span className="block text-xs text-muted-foreground">
                      View events, sessions, speakers, submissions, and configuration.
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer gap-3 rounded-md border border-border p-3 has-checked:border-primary has-checked:bg-accent/50">
                  <input
                    type="radio"
                    name="permission"
                    value="write"
                    checked={permission === "write"}
                    onChange={() => setPermission("write")}
                    className="mt-0.5 accent-primary"
                  />
                  <span>
                    <span className="block text-sm font-medium text-foreground">
                      Read &amp; write
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      Also create and edit speakers and sessions, schedule sessions, and decide
                      submissions. Decisions may send email.
                    </span>
                  </span>
                </label>
              </fieldset>

              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium text-foreground">Event access</legend>
                <label className="flex cursor-pointer gap-3 rounded-md border border-border p-3 has-checked:border-primary has-checked:bg-accent/50">
                  <input
                    type="radio"
                    name="event-access"
                    value="all"
                    checked={eventAccess === "all"}
                    onChange={() => setEventAccess("all")}
                    className="mt-0.5 accent-primary"
                  />
                  <span>
                    <span className="block text-sm font-medium text-foreground">
                      All events
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      Includes every current event and any events created later.
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer gap-3 rounded-md border border-border p-3 has-checked:border-primary has-checked:bg-accent/50">
                  <input
                    type="radio"
                    name="event-access"
                    value="selected"
                    checked={eventAccess === "selected"}
                    onChange={() => setEventAccess("selected")}
                    className="mt-0.5 accent-primary"
                    disabled={events.length === 0}
                  />
                  <span>
                    <span className="block text-sm font-medium text-foreground">
                      Selected events
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      Restrict the key to only the events chosen below.
                    </span>
                  </span>
                </label>

                {eventAccess === "selected" ? (
                  <div className="ml-7 max-h-40 overflow-y-auto rounded-md border border-border p-2">
                    {events.map((event) => (
                      <label
                        key={event.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted"
                      >
                        <Checkbox
                          checked={eventIds.includes(event.id)}
                          onCheckedChange={(checked) => toggleEvent(event.id, checked === true)}
                        />
                        <span className="min-w-0 truncate text-sm text-foreground">
                          {event.name}
                        </span>
                      </label>
                    ))}
                  </div>
                ) : null}
              </fieldset>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="api-key-expiry">Expires after</Label>
                <NativeSelect
                  id="api-key-expiry"
                  value={expiresInDays}
                  onChange={(event) => setExpiresInDays(event.target.value)}
                  className="w-full"
                >
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="365">365 days</option>
                </NativeSelect>
              </div>

              {error ? <p className="text-sm text-destructive">{error}</p> : null}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={submitting || (eventAccess === "selected" && eventIds.length === 0)}
                >
                  {submitting ? "Creating…" : "Create key"}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
