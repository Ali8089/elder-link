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
  testControls: { en: "Call controls", zh: "致電控制" },
  analytics: { en: "Health & results", zh: "系統狀況" },
  notice: { en: "Elder Link supports care teams. It does not replace 999 or emergency services.", zh: "長者連線支援關顧團隊，不能取代 999 或緊急服務。" },
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
  staff: { en: "Care team", zh: "服務團隊" },
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
  testOnly: { en: "Staff operations — calls are placed to enrolled elders only", zh: "職員操作區 — 只會致電已登記長者" },
  demoCall: { en: "Place check-in call", zh: "致電問候" },
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
  realCallUnavailable: { en: "No telephony provider is active — the result was recorded manually instead.", zh: "電話供應商未啟用 — 已改為人手記錄結果。" },
  realCallPlaced: { en: "Real call placed. The answer arrives via the provider webhook.", zh: "已發出真實來電，回應會經供應商回傳。" },
  demoCallTitle: { en: "Cantonese check-in call", zh: "廣東話問候來電" },
  demoCallNote: { en: "Plays the Cantonese check-in script and captures the reply on the keypad (1 = fine, 2 = unwell, 3 = help). The answer is processed by the same rules engine as every scheduled call, so cases, escalation and analytics update exactly as they would in the field.", zh: "播放廣東話問候稿，並以鍵盤接收回應（1 = 冇事、2 = 唔舒服、3 = 求救）。回應會由同所有定時來電一樣嘅規則引擎處理，因此個案、轉介及數據會同真實情況一致更新。" },
  demoCallUnavailable: { en: "The telephony connection is not active yet. Set TELEPHONY_PROVIDER and the provider credentials to enable live calls.", zh: "電話線路尚未接通。設定 TELEPHONY_PROVIDER 及供應商憑證後即可致電。" },
  consentChecked: { en: "Consent re-checked before call", zh: "致電前已重新核對同意" },
  notifications: { en: "Notifications", zh: "通知紀錄" },
  versionConflict: { en: "This case was changed by someone else. Reload and try again.", zh: "此個案已被他人更新，請重新載入再試。" },
  schedulerNote: { en: "Check-ins, retries, chain timeouts and 30-day deletions run on the server every minute (cron). The dashboard also advances due retries while it is open.", zh: "到期致電、重撥、聯絡鏈超時及 30 日刪除均由伺服器每分鐘自動處理（排程）。儀表板開啟時亦會處理到期重撥。" },
  family: { en: "Family", zh: "家人" },
  familyTitle: { en: "Family monitoring", zh: "家人關注" },
  familyIntro: { en: "Follow your relative's check-in calls and alerts. Staff make every emergency decision — this page is read-only for family.", zh: "查看你親人嘅問候來電同警報。所有緊急決定由職員負責 — 呢一頁對家人只供查看。" },
  familyNoRole: { en: "Your account is not linked to an elder yet. Ask the care team to send you an invitation.", zh: "你嘅帳戶尚未連結任何長者。請通知服務團隊向你發出邀請。" },
  familyPending: { en: "Awaiting approval", zh: "等待確認" },
  familyAwaiting: { en: "the care team will confirm this link shortly", zh: "服務團隊會盡快確認連結" },
  familyNone: { en: "No linked elder yet.", zh: "尚未連結任何長者。" },
  familyAlerts: { en: "Alerts and escalations", zh: "警報及轉介" },
  familyNoAlerts: { en: "No open alerts. All recent check-ins were fine.", zh: "冇未處理嘅警報，最近嘅問候都正常。" },
  familyHandledBy: { en: "Being handled by", zh: "正由以下人士跟進" },
  familyStaffReviewing: { en: "the care team", zh: "服務團隊" },
  familyReadOnly: { en: "The care team decides all emergency actions.", zh: "所有緊急行動由服務團隊決定。" },
  familyActivity: { en: "Community activity interest", zh: "社區活動興趣" },
  familyNoActivity: { en: "No activity interest recorded yet.", zh: "暫未記錄活動興趣。" },
  familyInterestNote: { en: "your relative showed interest", zh: "你嘅親人表示有興趣" },
  familyCalls: { en: "Recent check-in calls", zh: "最近問候來電" },
  familyNoCalls: { en: "No calls recorded yet.", zh: "暫未有通話紀錄。" },
  familyWhen: { en: "When", zh: "時間" },
  familyElder: { en: "Elder", zh: "長者" },
  familyResult: { en: "Result", zh: "結果" },
  familyPrefs: { en: "Your notification preferences", zh: "你嘅通知設定" },
  familyNotifyLevel: { en: "What you want to hear about", zh: "你想收到咩通知" },
  familyNotifyAll: { en: "Alerts and community news", zh: "警報及社區消息" },
  familyNotifyAlerts: { en: "Alerts only", zh: "只收警報" },
  familyNotifyNone: { en: "Do not contact me", zh: "不用聯絡我" },
  familyActivityOptIn: { en: "Also send community activity news", zh: "同時發送社區活動消息" },
  familyMuted: { en: "You have asked not to be contacted. Alerts are still recorded for staff.", zh: "你已選擇唔接收通知。警報仍會記錄俾職員跟進。" },
  familyStaffView: { en: "staff view — contact details are masked", zh: "職員檢視 — 聯絡資料已遮蓋" },
  familyStaffNotice: { en: "You are seeing this as staff. Family members see only their own relative.", zh: "你正以職員身分檢視。家人只會見到自己嘅親人。" },
  familyLinkedElder: { en: "Linked elder", zh: "已連結長者" },
  familyUnknownElder: { en: "an elder in your care", zh: "你嘅一位長者" },
  // Call replay — reconstruct a past call from its recorded job.
  listen: { en: "Listen", zh: "重播" },
  callReplay: { en: "Call replay", zh: "通話重播" },
  kind: { en: "Type", zh: "類型" },
  kind_scheduled: { en: "Scheduled check-in", zh: "定期問候" },
  kind_sensor: { en: "Sensor-triggered", zh: "感應器觸發" },
  kind_retry: { en: "Retry", zh: "重撥" },
  attempt: { en: "Attempt", zh: "嘗試次數" },
  status: { en: "Status", zh: "狀態" },
  replayAssistant: { en: "Assistant", zh: "助手" },
  replayElder: { en: "Elder (reconstructed)", zh: "長者（重建）" },
  replayReconstruction: { en: "Reconstructed from the recorded outcome", zh: "根據記錄結果重建" },
  replayReconstructionNote: {
    en: "The elder's words were never recorded. This line is reconstructed from the recorded outcome — it is not a verbatim transcript.",
    zh: "長者的說話從未被錄音。此行是根據記錄結果重建，並非逐字對話紀錄。",
  },
  replayNoAnswerText: {
    en: "No answer — the line was held open for 45 seconds.",
    zh: "無人接聽 — 線路保持接通 45 秒。",
  },
  replayPlay: { en: "Play call", zh: "播放通話" },
  replayPause: { en: "Pause", zh: "暫停" },
  replayRestart: { en: "Restart", zh: "重新播放" },
  replayPrev: { en: "Previous line", zh: "上一句" },
  replayNext: { en: "Next line", zh: "下一句" },
  replayMusic: { en: "Closing music playing", zh: "播放結尾音樂" },
  replayNoCall: { en: "This call never connected, so there is no audio to replay.", zh: "此通話未曾接通，因此沒有錄音可重播。" },
  replayNoCallShort: { en: "No audio", zh: "無錄音" },
  replayQueued: { en: "Queued until", zh: "排隊至" },
  replayClose: { en: "Close", zh: "關閉" },
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
