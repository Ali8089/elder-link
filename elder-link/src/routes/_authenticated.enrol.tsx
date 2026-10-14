import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { activationBlockers, containsHkid, nextCheckAt } from "@/lib/engine";
import { audit } from "@/lib/orchestrator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

export const Route = createFileRoute("/_authenticated/enrol")({
  head: () => ({
    meta: [
      { title: "Enrol an elder — Elder Link" },
      { name: "description", content: "Create a sample elder record; activation requires all consents, two contacts and the minimum sample fields." },
      { property: "og:title", content: "Enrol an elder — Elder Link" },
      { property: "og:description", content: "Enrol a sample elder with consent checks." },
    ],
  }),
  component: Enrol,
});

function Enrol() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [f, setF] = useState({
    display_name: "",
    reference_number: "",
    phone: "",
    preferred_call_time: "",
    centre: "",
    check_interval_days: 2,
    consent_elder: false,
    consent_contact: false,
    consent_service: false,
  });
  const [contacts, setContacts] = useState([{ name: "", relation: "", phone: "" }, { name: "", relation: "", phone: "" }]);
  const missing = activationBlockers({ ...f, contacts });

  async function save(activate: boolean): Promise<void> {
    const text = [f.display_name, f.reference_number, f.centre, ...contacts.map((c) => c.name + c.relation)].join(" ");
    if (containsHkid(text)) { toast.error("HKID numbers must not be entered. / 請勿輸入身份證號碼。"); return; }
    if (activate && missing.length) return;
    const now = new Date();
    const r = await supabase
      .from("elders")
      .insert({
        ...f,
        status: activate ? "active" : "draft",
        next_check_at: activate ? nextCheckAt(now, f.check_interval_days).toISOString() : null,
        consent_checked_at: activate ? now.toISOString() : null,
      })
      .select()
      .single();
    if (r.error) { toast.error(r.error.message); return; }
    const rows = contacts.map((c, i) => ({ ...c, priority: i + 1, elder_id: r.data.id })).filter((c) => c.name && c.phone);
    if (rows.length) await supabase.from("contacts").insert(rows);
    await audit(activate ? "elder.activate" : "elder.create", "elders", r.data.id);
    toast.success(t("saved"));
    navigate({ to: "/elders/$id", params: { id: r.data.id } });
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-3xl md:text-4xl">{t("enrol")}</h1>
      <p className="rounded-md bg-warn-soft p-3 text-sm font-semibold text-warn">⚠ {t("notice")}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="n" label={t("name")} value={f.display_name} onChange={(v) => setF({ ...f, display_name: v })} />
        <Field id="ref" label={t("reference")} value={f.reference_number} onChange={(v) => setF({ ...f, reference_number: v })} placeholder="EL-0001" />
        <Field id="p" label={t("phone")} value={f.phone} onChange={(v) => setF({ ...f, phone: v })} placeholder="+852 5000 0000" />
        <Field id="ct" label={t("centre")} value={f.centre} onChange={(v) => setF({ ...f, centre: v })} placeholder="Sham Shui Po" />
        <Field id="pt" label={t("preferredCallTime")} value={f.preferred_call_time} onChange={(v) => setF({ ...f, preferred_call_time: v })} placeholder="10:00" />
        <div className="space-y-2">
          <Label htmlFor="iv">{t("interval")}</Label>
          <select id="iv" className="h-12 w-full rounded-md border border-input bg-card px-3" value={f.check_interval_days} onChange={(e) => setF({ ...f, check_interval_days: Number(e.target.value) })}>
            <option value={2}>2 {t("days")}</option>
            <option value={3}>3 {t("days")}</option>
          </select>
        </div>
      </div>
      <fieldset className="space-y-3">
        <legend className="font-bold">{t("contactsLabel")}</legend>
        {contacts.map((c, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-3">
            {(["name", "relation", "phone"] as const).map((k) => (
              <Input key={k} aria-label={`${i + 1} ${k}`} placeholder={k} className="h-12" value={c[k]} onChange={(e) => setContacts(contacts.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} />
            ))}
          </div>
        ))}
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="font-bold">{t("consent")}</legend>
        {(["consent_elder", "consent_contact", "consent_service"] as const).map((k) => (
          <label key={k} className="flex min-h-11 items-center gap-3">
            <Checkbox checked={f[k]} onCheckedChange={(v) => setF({ ...f, [k]: v === true })} className="h-6 w-6" />
            {t(k)}
          </label>
        ))}
      </fieldset>
      <div role="status" aria-live="polite">
        {missing.length > 0 && (
          <div className="rounded-md border border-warn p-3">
            <p className="font-bold">{t("missing")}</p>
            <ul className="list-disc pl-6">{missing.map((m) => <li key={m}>{t(m)}</li>)}</ul>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" className="h-12" onClick={() => save(false)} disabled={!f.display_name.trim()}>{t("saveDraft")}</Button>
        <Button className="h-12" onClick={() => save(true)} disabled={missing.length > 0}>{t("activate")}</Button>
      </div>
    </div>
  );
}

function Field({ id, label, value, onChange, placeholder }: { id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} className="h-12" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
