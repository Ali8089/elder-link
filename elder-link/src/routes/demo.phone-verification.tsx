// /demo/phone-verification — 模擬電話驗證示範頁
//
// 呢一頁示範「發送驗證碼 → 輸入驗證碼 → 驗證成功」嘅完整流程，
// 全程唔會發真短訊、唔會打真電話、亦都唔會連接任何第三方服務。
// 所有可見文字同註解都用廣東話。
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Phone, ShieldCheck, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/demo/phone-verification")({
  head: () => ({
    meta: [
      { title: "模擬電話驗證示範 — 長者連線" },
      {
        name: "description",
        content: "示範用電話驗證流程：唔會發真短訊，只用假資料模擬整個驗證過程。",
      },
    ],
  }),
  component: MockPhoneVerificationDemo,
});

/** 流程狀態。 */
type Stage = "input" | "code" | "done";

const EMPTY_PHONE = "";
const EMPTY_CODE = "";

function MockPhoneVerificationDemo() {
  const [stage, setStage] = useState<Stage>("input");
  const [phone, setPhone] = useState(EMPTY_PHONE);
  const [code, setCode] = useState(EMPTY_CODE);
  const [maskedPhone, setMaskedPhone] = useState("");
  const [demoCode, setDemoCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);

  // 自動把焦點移去驗證碼輸入框，方便使用者。
  useEffect(() => {
    if (stage === "code") codeInputRef.current?.focus();
  }, [stage]);

  const callApi = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch("/api/demo/mock-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as Record<string, any>;
  }, []);

  /** 第一步：發送模擬驗證碼。 */
  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const data = await callApi({ action: "start", phone });
      if (!data["ok"]) {
        setError(String(data["error"] ?? "發送失敗，請再試一次。"));
        return;
      }
      setMaskedPhone(String(data["masked_phone"] ?? ""));
      setDemoCode(String(data["demo_code"] ?? ""));
      setStage("code");
      setCode(EMPTY_CODE);
      setInfo("模擬驗證碼已發送（示範環境唔會發出真短訊）。");
    } catch {
      setError("連接伺服器失敗，請稍後再試。");
    } finally {
      setBusy(false);
    }
  }

  /** 第二步：核對驗證碼。 */
  async function checkCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const data = await callApi({ action: "verify", phone, code });
      if (!data["ok"]) {
        setError(String(data["error"] ?? "驗證失敗，請再試一次。"));
        return;
      }
      setStage("done");
    } catch {
      setError("連接伺服器失敗，請稍後再試。");
    } finally {
      setBusy(false);
    }
  }

  /** 重新開始。 */
  function restart() {
    setStage("input");
    setPhone(EMPTY_PHONE);
    setCode(EMPTY_CODE);
    setMaskedPhone("");
    setDemoCode("");
    setError(null);
    setInfo(null);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-6 px-4 py-10">
      {/* 示範橫額：一定要清楚講明唔會發真短訊 */}
      <div
        role="note"
        className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm"
      >
        <p className="font-medium">⚠ 示範模式</p>
        <p className="mt-1 opacity-90">
          呢個係模擬電話驗證示範。系統<span className="font-semibold">唔會</span>發出真短訊、
          唔會打真電話，亦都唔會連接任何真實驗證服務。
        </p>
      </div>

      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ShieldCheck className="size-6" aria-hidden="true" />
          電話號碼驗證
        </h1>
        <p className="text-sm opacity-80">
          輸入香港電話號碼，接收模擬驗證碼，完成驗證流程。
        </p>
      </header>

      {/* 進度指示 */}
      <ol className="flex items-center gap-2 text-xs" aria-label="驗證進度">
        <ProgressStep n={1} label="輸入號碼" active={stage === "input"} done={stage !== "input"} />
        <span aria-hidden="true" className="opacity-40">→</span>
        <ProgressStep n={2} label="輸入驗證碼" active={stage === "code"} done={stage === "done"} />
        <span aria-hidden="true" className="opacity-40">→</span>
        <ProgressStep n={3} label="完成" active={stage === "done"} done={false} />
      </ol>

      {/* 錯誤同提示訊息 */}
      {error ? (
        <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm">
          {error}
        </p>
      ) : null}
      {info && !error ? (
        <p role="status" aria-live="polite" className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm">
          {info}
        </p>
      ) : null}

      {/* 第一步：輸入電話號碼 */}
      {stage === "input" ? (
        <form onSubmit={sendCode} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="phone">
              <Phone className="mr-1 inline size-4" aria-hidden="true" />
              電話號碼
            </Label>
            <Input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+852 9123 4567"
              value={phone}
              onChange={(ev) => setPhone(ev.target.value)}
              aria-describedby="phone-hint"
              required
            />
            <p id="phone-hint" className="text-xs opacity-70">
              請輸入香港電話號碼，例如 +852 9123 4567。
            </p>
          </div>
          <Button type="submit" className="w-full" disabled={busy || phone.trim() === ""}>
            {busy ? "發送中…" : "發送驗證碼"}
          </Button>
        </form>
      ) : null}

      {/* 第二步：輸入驗證碼 */}
      {stage === "code" ? (
        <form onSubmit={checkCode} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="code">
              <Smartphone className="mr-1 inline size-4" aria-hidden="true" />
              驗證碼
            </Label>
            <Input
              id="code"
              name="code"
              ref={codeInputRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="6 位數字"
              value={code}
              onChange={(ev) => setCode(ev.target.value.replace(/\D/g, "").slice(0, 6))}
              aria-describedby="code-hint"
              required
            />
            <p id="code-hint" className="text-xs opacity-70">
              驗證碼已「發送」到 {maskedPhone || "你嘅電話"}。
              {demoCode ? (
                <>
                  {" "}
                  示範用驗證碼：
                  <code className="rounded bg-black/10 px-1 py-0.5 font-mono dark:bg-white/10">
                    {demoCode}
                  </code>
                </>
              ) : null}
            </p>
          </div>
          <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
            {busy ? "驗證中…" : "確認驗證碼"}
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={restart} disabled={busy}>
            更改電話號碼
          </Button>
        </form>
      ) : null}

      {/* 第三步：成功 */}
      {stage === "done" ? (
        <div
          role="status"
          aria-live="polite"
          className="space-y-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-5 text-center"
        >
          <CheckCircle2 className="mx-auto size-12 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          <h2 className="text-xl font-semibold">驗證成功！</h2>
          <p className="text-sm opacity-90">
            電話號碼 {maskedPhone || ""} 已經通過模擬驗證。
          </p>
          <p className="text-xs opacity-70">（示範用，唔代表任何真實電話驗證。）</p>
          <Button type="button" variant="outline" className="w-full" onClick={restart}>
            再試一次
          </Button>
        </div>
      ) : null}

      <footer className="text-center text-xs opacity-60">
        長者連線示範原型 — 只用虛構資料，唔會發出真短訊或真來電。
      </footer>
    </main>
  );
}

/** 進度步驟指示器。 */
function ProgressStep({
  n,
  label,
  active,
  done,
}: {
  n: number;
  label: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <li
      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ${
        active ? "bg-foreground text-background" : done ? "bg-emerald-500/20" : "bg-muted"
      }`}
      aria-current={active ? "step" : undefined}
    >
      <span className="font-mono">{done ? "✓" : n}</span>
      <span>{label}</span>
    </li>
  );
}
