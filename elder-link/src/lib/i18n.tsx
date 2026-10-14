import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "en" | "zh";

const dict = {
  appName: { en: "Elder Link", zh: "長者連線" },
  tagline: { en: "Check-in calls for elders living alone", zh: "獨居長者關懷來電" },
  signIn: { en: "Sign in", zh: "登入" },
  signUp: { en: "Create staff account", zh: "建立職員帳戶" },
  email: { en: "Email", zh: "電郵" },
  password: { en: "Password", zh: "密碼" },
  signOut: { en: "Sign out", zh: "登出" },
  haveAccount: { en: "Already have an account? Sign in", zh: "已有帳戶？登入" },
  noAccount: { en: "New staff member? Create an account", zh: "新職員？建立帳戶" },
  checkEmail: { en: "Check your email to confirm your account.", zh: "請查看電郵確認帳戶。" },
  locked: { en: "Too many failed attempts. Try again in 15 minutes.", zh: "嘗試次數過多，請於 15 分鐘後再試。" },
  cases: { en: "Cases", zh: "個案" },
  elders: { en: "Elders", zh: "長者" },
  enrol: { en: "Enrol", zh: "登記" },
  testControls: { en: "Test controls", zh: "測試控制" },
  analytics: { en: "Health & results", zh: "系統狀況" },
  notice: { en: "Prototype — fake data and consenting team numbers only. Not a replacement for 999.", zh: "原型系統 — 只用虛構資料及已同意的團隊電話。不能取代 999。" },
  all: { en: "All", zh: "全部" },
  open: { en: "Open", zh: "待處理" },
  acknowledged: { en: "Acknowledged", zh: "已確認" },
  closed: { en: "Closed", zh: "已完成" },
  overdue: { en: "Overdue check-in", zh: "逾期未聯絡" },
  safe: { en: "Safe", zh: "安全" },
  worrying: { en: "Worrying", zh: "需關注" },
  danger: { en: "Immediate danger", zh: "即時危險" },
  unclear: { en: "Unclear", zh: "不清楚" },
  no_answer: { en: "No answer", zh: "無人接聽" },
  sensor: { en: "Sensor alert", zh: "感應器警報" },
  acknowledge: { en: "Acknowledge", zh: "確認接手" },
  closeCase: { en: "Mark follow-up complete", zh: "完成跟進" },
  note: { en: "Short note", zh: "簡短備註" },
  saveNote: { en: "Save note", zh: "儲存備註" },
  chain: { en: "Contact chain", zh: "聯絡次序" },
  contact1: { en: "First contact", zh: "第一聯絡人" },
  contact2: { en: "Second contact", zh: "第二聯絡人" },
  operator: { en: "Operator", zh: "值班職員" },
  history: { en: "Call history", zh: "通話紀錄" },
  consent: { en: "Consent", zh: "同意書" },
  consent_elder: { en: "Elder consents", zh: "長者同意" },
  consent_contact: { en: "Contacts consent", zh: "聯絡人同意" },
  consent_service: { en: "Service agreement", zh: "服務同意" },
  name: { en: "Display name", zh: "稱呼" },
  district: { en: "District", zh: "地區" },
  phone: { en: "Phone", zh: "電話" },
  interval: { en: "Check every", zh: "致電間隔" },
  days: { en: "days", zh: "日" },
  contactsLabel: { en: "Two contacts (name + phone)", zh: "兩位聯絡人（姓名及電話）" },
  contacts: { en: "Two contacts", zh: "兩位聯絡人" },
  saveDraft: { en: "Save draft", zh: "儲存草稿" },
  activate: { en: "Activate", zh: "啟用" },
  missing: { en: "Still needed before activation:", zh: "啟用前仍需：" },
  active: { en: "Active", zh: "啟用中" },
  draft: { en: "Draft", zh: "草稿" },
  opted_out: { en: "Opted out", zh: "已退出" },
  optOut: { en: "Opt out (delete in 30 days)", zh: "退出服務（30 日後刪除）" },
  nextCheck: { en: "Next check", zh: "下次致電" },
  testOnly: { en: "TEST ONLY — simulated calls, no real elders", zh: "只供測試 — 模擬來電，並非真實長者" },
  demoCall: { en: "Run demo call", zh: "模擬致電" },
  answerAs: { en: "Elder's answer", zh: "長者回應" },
  triggerSensor: { en: "Trigger sensor alert", zh: "觸發感應器" },
  runDue: { en: "Run due check-ins now", zh: "立即處理到期致電" },
  chainAnswer: { en: "Current contact answers", zh: "聯絡人接聽" },
  chainNoAnswer: { en: "Current contact no answer", zh: "聯絡人無接聽" },
  noCases: { en: "No cases match this filter.", zh: "沒有符合的個案。" },
  escalationTime: { en: "Escalation start", zh: "開始轉介" },
  within60: { en: "within 60 s", zh: "60 秒內" },
  over60: { en: "over 60 s", zh: "超過 60 秒" },
  unresolved: { en: "Unresolved cases", zh: "未解決個案" },
  callsToday: { en: "Calls (all time)", zh: "通話總數" },
  activity: { en: "Activity suggested", zh: "建議活動" },
  script: { en: "Call script (draft)", zh: "通話稿（草稿）" },
  back: { en: "Back", zh: "返回" },
  retryScheduled: { en: "Retry scheduled", zh: "已安排重撥" },
  saved: { en: "Saved", zh: "已儲存" },
  fastForward: { en: "Make pending retries due now", zh: "立即執行待重撥" },
  schedulerNote: { en: "Retries run automatically every 30 seconds while any staff dashboard is open. Opted-out records are deleted daily after 30 days.", zh: "只要有職員開啟系統，重撥會每 30 秒自動處理。退出服務的紀錄會於 30 日後每日自動刪除。" },
  noAccess: { en: "Your account has no staff role yet.", zh: "你的帳戶尚未獲分配職員權限。" },
  reference: { en: "Reference no.", zh: "檔案編號" },
  preferredCallTime: { en: "Preferred call time", zh: "偏好致電時間" },
  centre: { en: "Centre", zh: "服務中心" },
  interest: { en: "Activity interest", zh: "活動興趣" },
  markInterest: { en: "Mark activity interest", zh: "標記對活動有興趣" },
  interestRecorded: { en: "Activity interest recorded", zh: "已記錄活動興趣" },
  reschedule: { en: "Reschedule", zh: "更改致電安排" },
  saveChanges: { en: "Save changes", zh: "儲存更改" },
  realCall: { en: "Place real call (server)", zh: "真實致電（伺服器）" },
  realCallUnavailable: { en: "No real provider configured — used the simulated call instead.", zh: "未設定真實電話供應商 — 已改用模擬致電。" },
  realCallPlaced: { en: "Real call placed. The answer arrives via the provider webhook.", zh: "已發出真實來電，回應會經供應商回傳。" },
  consentChecked: { en: "Consent re-checked before call", zh: "致電前已重新核對同意" },
  notifications: { en: "Notifications", zh: "通知紀錄" },
  versionConflict: { en: "This case was changed by someone else. Reload and try again.", zh: "此個案已被他人更新，請重新載入再試。" },
  schedulerNote: { en: "Check-ins, retries, chain timeouts and 30-day deletions run on the server every minute (cron). The dashboard also advances due retries while it is open.", zh: "到期致電、重撥、聯絡鏈超時及 30 日刪除均由伺服器每分鐘自動處理（排程）。儀表板開啟時亦會處理到期重撥。" },
} as const;

export type Key = keyof typeof dict;

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (k: Key | string) => string }>({
  lang: "zh",
  setLang: () => {},
  t: (k) => String(k),
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("zh");
  useEffect(() => {
    const s = localStorage.getItem("el-lang");
    if (s === "en" || s === "zh") setLangState(s);
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-HK" : "en";
  }, [lang]);
  const setLang = (l: Lang) => {
    localStorage.setItem("el-lang", l);
    setLangState(l);
  };
  const t = (k: Key | string) => (k in dict ? dict[k as Key][lang] : String(k));
  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);

export function LangSwitch() {
  const { lang, setLang } = useI18n();
  return (
    <div role="group" aria-label="Language / 語言" className="inline-flex rounded-md border border-current/30 p-0.5">
      {(["zh", "en"] as const).map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={lang === l}
          onClick={() => setLang(l)}
          className={`min-h-10 rounded px-3 text-sm font-semibold ${lang === l ? "bg-primary text-primary-foreground" : ""}`}
        >
          {l === "zh" ? "繁中" : "EN"}
        </button>
      ))}
    </div>
  );
}
