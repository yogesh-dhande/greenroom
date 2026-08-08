import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export interface StatCardProps {
  label: string;
  value: number | string;
  sublabel?: string;
}

/** Single number with a label — the building block of the event overview.
 * Composed from shadcn's Card primitives so spacing/radius/colors all come
 * from the token set. */
export function StatCard({ label, value, sublabel }: StatCardProps) {
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <p className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
          {value}
        </p>
        {sublabel && <CardDescription className="mt-1">{sublabel}</CardDescription>}
      </CardContent>
    </Card>
  );
}
