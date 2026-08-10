"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  DEFAULT_EMBED_CONFIG,
  embedOutput,
  embedSurfacePath,
  type EmbedConfig,
  type EmbedFormat,
  type EmbedWidget,
} from "@/domain/embed-config";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

const WIDGETS: Array<[EmbedWidget, string]> = [
  ["sessions", "List of Sessions"],
  ["speakers", "List of Speakers"],
  ["agenda", "Agenda"],
  ["itinerary", "Schedule Itinerary"],
  ["gallery", "Speaker Gallery"],
];
const FORMATS: Array<[EmbedFormat, string]> = [
  ["script", "Script / basic HTML"],
  ["iframe", "iframe"],
  ["json", "JSON"],
  ["xml", "XML"],
  ["ical", "iCal"],
];

export function EmbedBuilder({ eventSlug, tracks, origin }: { eventSlug: string; tracks: string[]; origin: string }) {
  const [format, setFormat] = useState<EmbedFormat>("script");
  const [config, setConfig] = useState<EmbedConfig>(DEFAULT_EMBED_CONFIG);
  const output = useMemo(
    () => embedOutput(origin, eventSlug, format, config),
    [origin, eventSlug, format, config],
  );
  const patch = (values: Partial<EmbedConfig>) => setConfig((current) => ({ ...current, ...values }));
  const isHtml = format === "script" || format === "iframe";

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,1fr)]">
      <Card>
        <CardHeader><CardTitle>Configuration</CardTitle></CardHeader>
        <CardContent className="grid gap-5">
          <Field label="Widget type">
            <NativeSelect
              aria-label="Widget type"
              value={config.widget}
              onChange={(event) => patch({ widget: event.target.value as EmbedWidget })}
              className="w-64"
            >
              {WIDGETS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Output format">
            <NativeSelect
              aria-label="Output format"
              value={format}
              onChange={(event) => setFormat(event.target.value as EmbedFormat)}
              className="w-64"
            >
              {FORMATS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Content filters">
            <NativeSelect
              aria-label="Track filter"
              value={config.track ?? ""}
              onChange={(event) => patch({ track: event.target.value || null })}
              className="w-64"
            >
              <option value="">All tracks</option>
              {tracks.map((track) => <option key={track} value={track}>{track}</option>)}
            </NativeSelect>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked disabled /> Approved sessions only
            </label>
          </Field>
          <Field label="Card fields">
            <Toggle label="Description" checked={config.showDescription} onChange={(value) => patch({ showDescription: value })} />
            <Toggle label="Speaker title and company" checked={config.showAffiliation} onChange={(value) => patch({ showAffiliation: value })} />
            <Toggle label="Biography" checked={config.showBio} onChange={(value) => patch({ showBio: value })} />
            <Toggle label="Headshot" checked={config.showHeadshot} onChange={(value) => patch({ showHeadshot: value })} />
            <Toggle label="Social links" checked={config.showLinks} onChange={(value) => patch({ showLinks: value })} />
          </Field>
          <Field label="Brand colors">
            <Color label="Primary" value={config.primaryColor} onChange={(primaryColor) => patch({ primaryColor })} />
            <Color label="Background" value={config.backgroundColor} onChange={(backgroundColor) => patch({ backgroundColor })} />
            <Color label="Text" value={config.textColor} onChange={(textColor) => patch({ textColor })} />
          </Field>
          <Field label="Custom CSS">
            <Textarea
              aria-label="Custom CSS"
              maxLength={1000}
              placeholder=".my-selector { ... }"
              value={config.customCss}
              onChange={(event) => patch({ customCss: event.target.value })}
            />
          </Field>
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader><CardTitle>Generated output</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          <pre data-testid="embed-output" className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-4 text-xs">{output}</pre>
          <div className="flex gap-2">
            <Button onClick={() => copy(output)}>Copy</Button>
            {isHtml && origin ? (
              <Button asChild variant="outline">
                <a href={`${origin}${embedSurfacePath(eventSlug, config)}`} target="_blank" rel="noreferrer">Preview</a>
              </Button>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            Configuration is encoded in the URL, so there is nothing extra to save or maintain.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <fieldset className="grid gap-2"><legend className="mb-1 text-sm font-semibold">{label}</legend>{children}</fieldset>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />{label}</label>;
}

function Color({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="flex max-w-xs items-center gap-3 text-sm"><span className="w-24">{label}</span><Input aria-label={`${label} color`} type="color" value={value} onChange={(event) => onChange(event.target.value)} className="w-16 p-1" /><code>{value}</code></label>;
}

async function copy(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success("Copied");
  } catch {
    toast.error("Couldn't copy — select and copy it manually");
  }
}
