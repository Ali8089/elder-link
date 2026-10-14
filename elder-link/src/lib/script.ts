// DRAFT bilingual call script — pending final Cantonese wording approval.
// Never asks for money, HKID, bank or medical details.
//
// `zh` is what the automated assistant "speaks" on the demo call.
// `en` is the staff-facing translation shown in the dashboard.
export const CALL_SCRIPT = [
  { id: "disclosure", zh: "你好，我係長者連線嘅自動電話助手，唔係真人。今次來電係定期問候。", en: "Hello, this is Elder Link's automated phone assistant, not a person. This is your regular check-in call." },
  { id: "ask", zh: "請問你今日覺得點呀？可以按 1 字話我知你冇事，按 2 字話我知你有啲唔舒服，按 3 字求救。", en: "How are you feeling today? Press 1 if you're fine, 2 if you're unwell, or 3 for help." },
  { id: "safe", zh: "好高興聽到你安好。今日天氣唔錯，可以去附近公園散步十五分鐘。", en: "Glad to hear you're well. The weather's nice today — a 15-minute walk in a nearby park would do you good." },
  { id: "worry", zh: "多謝你話我知。我而家會請職員或你嘅家人聯絡你，請你留喺屋企等電話。", en: "Thank you for telling me. I'll ask a staff member or your family to contact you now — please stay home and wait for the call." },
  { id: "danger", zh: "如果你而家有即時危險，請立即打 999。我而家即刻通知職員同你嘅家人。", en: "If you are in immediate danger, please call 999 now. I'm alerting staff and your family right away." },
  { id: "unclear", zh: "唔好意思，我聽得唔太清楚。我而家會請職員跟進你嘅情況。", en: "Sorry, I didn't catch that clearly. I'll have a staff member follow up." },
  { id: "no_answer", zh: "冇人接聽，我哋會喺 5 至 10 分鐘後再打俾你。", en: "No answer — we'll try calling you again in 5 to 10 minutes." },
  { id: "close", zh: "我哋會再打俾你。保重身體，再見！", en: "We'll call you again soon. Take care, goodbye!" },
] as const;

/** Lookup a single script line by id. */
export function scriptLine(id: string) {
  return CALL_SCRIPT.find((s) => s.id === id);
}

/**
 * Keypad mapping shown on the demo phone: digit → the phrase it stands for.
 * Mirrors DTMF_ANSWERS in engine.ts so the keypad and the script agree.
 */
export const KEYPAD_PROMPT = [
  { digit: "1", zh: "冇事", en: "Fine", outcome: "safe" as const },
  { digit: "2", zh: "唔舒服", en: "Unwell", outcome: "worrying" as const },
  { digit: "3", zh: "求救", en: "Need help", outcome: "danger" as const },
] as const;
