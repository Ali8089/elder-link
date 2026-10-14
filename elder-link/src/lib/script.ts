// DRAFT bilingual call script — pending final Cantonese wording approval.
// Never asks for money, HKID, bank or medical details.
export const CALL_SCRIPT = [
  { id: "disclosure", zh: "你好，我係長者連線嘅自動電話助手，唔係真人。今次來電係定期問候。", en: "Hello, this is Elder Link's automated phone assistant, not a person. This is your regular check-in call." },
  { id: "ask", zh: "請問你今日覺得點呀？", en: "How are you feeling today?" },
  { id: "safe", zh: "好高興聽到你安好。", en: "Glad to hear you're well." },
  { id: "worry", zh: "多謝你話我知，我而家會請職員或你嘅家人聯絡你。", en: "Thank you for telling me. I'll ask a staff member or your family to contact you now." },
  { id: "danger", zh: "如果有即時危險，請立即打 999。我而家通知職員。", en: "If you are in immediate danger, please call 999 now. I'm alerting staff." },
  { id: "close", zh: "我哋會再打俾你。保重！", en: "We'll call you again soon. Take care!" },
] as const;
