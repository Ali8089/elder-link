import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PhoneCall, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { LangSwitch, useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Elder Link — Staff sign in" },
      { name: "description", content: "Elder Link staff dashboard for Cantonese check-in calls to Hong Kong elders living alone." },
      { property: "og:title", content: "Elder Link — Staff sign in" },
      { property: "og:description", content: "Shared bilingual dashboard for elder check-in calls and human escalation." },
    ],
  }),
  component: SignIn,
});

function SignIn() {
  const { t, lang } = useI18n();
  const { session } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session) nav({ to: "/cases" });
  }, [session, nav]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === "in") {
        // Sign-in goes through the server so the 5-failures / 15-minute lockout
        // is enforced on the server, not in the browser.
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const json = (await res.json()) as {
          access_token?: string;
          refresh_token?: string;
          error?: { message?: string };
        };
        if (!res.ok || !json.access_token) {
          setError(json.error?.message ?? (lang === "zh" ? "登入失敗。" : "Sign-in failed."));
        } else {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: json.access_token,
            refresh_token: json.refresh_token!,
          });
          if (sessionError) setError(sessionError.message);
        }
      } else {
        // Sign-up is allow-listed on the server (ALLOWED_STAFF_EMAILS).
        const res = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const json = (await res.json()) as { ok?: boolean; error?: { message?: string } };
        if (!res.ok || !json.ok) {
          setError(json.error?.message ?? (lang === "zh" ? "建立帳戶失敗。" : "Sign-up failed."));
        } else {
          setInfo(lang === "zh" ? "帳戶已建立，可立即登入。" : "Account created — you can sign in now.");
          setMode("in");
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="flex flex-col justify-between bg-sidebar p-8 text-sidebar-foreground lg:p-14">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-xl font-bold">
            <PhoneCall aria-hidden className="h-6 w-6 text-sidebar-primary" /> {t("appName")}
          </span>
          <LangSwitch />
        </div>
        <div className="py-12">
          <h1 className="text-4xl leading-tight lg:text-6xl">{t("tagline")}</h1>
          <p className="mt-6 max-w-md text-lg opacity-90">
            每兩至三日一次粵語問候電話 · Cantonese check-ins every 2–3 days, with a human always deciding emergencies.
          </p>
        </div>
        <p className="flex items-start gap-2 text-sm opacity-85">
          <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0" /> {t("notice")}
        </p>
      </section>
      <section className="flex items-center justify-center p-8">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5" aria-describedby="form-status">
          <h2 className="text-3xl">{mode === "in" ? t("signIn") : t("signUp")}</h2>
          <div className="space-y-2">
            <Label htmlFor="email">{t("email")}</Label>
            <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-12 text-base" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pw">{t("password")}</Label>
            <Input id="pw" type="password" required minLength={8} autoComplete={mode === "in" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} className="h-12 text-base" />
          </div>
          <div id="form-status" role="status" aria-live="polite">
            {error && <p className="rounded-md bg-danger-soft p-3 text-sm font-semibold text-destructive">⚠ {error}</p>}
            {info && <p className="rounded-md bg-safe-soft p-3 text-sm font-semibold text-safe">✓ {info}</p>}
          </div>
          <Button type="submit" disabled={busy} className="h-12 w-full text-base">
            {mode === "in" ? t("signIn") : t("signUp")}
          </Button>
          <button type="button" className="w-full text-sm underline" onClick={() => setMode(mode === "in" ? "up" : "in")}>
            {mode === "in" ? t("noAccount") : t("haveAccount")}
          </button>
        </form>
      </section>
    </main>
  );
}
