import type { CSSProperties, ReactNode } from "react";
import type { EmbedConfig } from "@/domain/embed-config";

export function EmbedFrame({
  config,
  children,
}: {
  config: EmbedConfig;
  children: ReactNode;
}) {
  const style = {
    "--primary": config.primaryColor,
    "--background": config.backgroundColor,
    "--foreground": config.textColor,
  } as CSSProperties;

  return (
    <div data-widget={config.widget} style={style} className="min-h-screen bg-background text-foreground">
      {config.customCss ? <style>{config.customCss}</style> : null}
      {children}
    </div>
  );
}
