import { AlertOctagon, AlertTriangle, CheckCircle2, Clock, HelpCircle, PhoneMissed, Radio } from "lucide-react";
import { useI18n } from "@/lib/i18n";

const styles: Record<string, { cls: string; Icon: typeof CheckCircle2 }> = {
  safe: { cls: "bg-safe-soft text-safe", Icon: CheckCircle2 },
  worrying: { cls: "bg-warn-soft text-warn", Icon: AlertTriangle },
  danger: { cls: "bg-danger-soft text-destructive", Icon: AlertOctagon },
  unclear: { cls: "bg-warn-soft text-warn", Icon: HelpCircle },
  no_answer: { cls: "bg-warn-soft text-warn", Icon: PhoneMissed },
  sensor: { cls: "bg-danger-soft text-destructive", Icon: Radio },
  overdue: { cls: "bg-warn-soft text-warn", Icon: Clock },
  open: { cls: "bg-danger-soft text-destructive", Icon: AlertOctagon },
  acknowledged: { cls: "bg-warn-soft text-warn", Icon: Clock },
  closed: { cls: "bg-safe-soft text-safe", Icon: CheckCircle2 },
  active: { cls: "bg-safe-soft text-safe", Icon: CheckCircle2 },
  draft: { cls: "bg-muted text-muted-foreground", Icon: HelpCircle },
  opted_out: { cls: "bg-muted text-muted-foreground", Icon: PhoneMissed },
};

export function StatusBadge({ kind }: { kind: string }) {
  const { t } = useI18n();
  const s = styles[kind] ?? styles["draft"]!;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-bold ${s.cls}`}>
      <s.Icon aria-hidden className="h-4 w-4" />
      {t(kind)}
    </span>
  );
}
