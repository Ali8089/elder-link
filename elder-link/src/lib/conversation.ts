// The conversational layer: what the assistant says, and what it understands.
//
// Two providers, chosen by environment, in the same shape as voice.ts and
// telephony.ts. The default is the offline one — a deterministic Cantonese
// script with keyword classification — so a fresh clone runs with no accounts
// and no network, and so a provider outage degrades the call rather than
// breaking it.
//
// The LLM is used for exactly two jobs, both narrow:
//
//   1. understand(utterance) -> Outcome
//      Classify what the elder said well enough to route the call.
//   2. reply(state) -> string
//      Produce the one line the assistant says next.
//
// Deliberately *not* given: the ability to decide whether to escalate, whether
// to contact family, or whether an emergency is real. Those stay in the rules
// engine (src/lib/engine.ts) where they are testable. The LLM is a language
// model, not a triage decision-maker, and a hallucinated "she seems fine" must
// never be able to close a case.
//
// Safety invariant, enforced in code below and covered by tests: an
// unavailable, slow, or nonsensical LLM response must fall back to the
// deterministic classifier, which never returns "safe" for anything it does
// not positively recognise.

import type { Outcome } from "./engine";

/** Everything the assistant knows when deciding what to say next. */
export type ConversationState = {
  /** The elder's display name, for a personal greeting. */
  elderName: string;
  /** What the elder said, transcribed. Empty when nothing was heard. */
  heard: string;
  /** Turns so far, oldest first. Bounded by the caller. */
  history: readonly { role: "assistant" | "elder"; text: string }[];
};

export interface ConversationEngine {
  readonly name: string;
  /**
   * Route the elder's answer. Must never return "safe" unless the utterance
   * positively indicates wellbeing — see the safety note above.
   */
  understand(state: ConversationState): Promise<Outcome>;
  /** The assistant's next line. May return "" to fall back to the script. */
  reply(state: ConversationState): Promise<string>;
}

// ---------------------------------------------------------------------------
// Offline engine — the default, and the fallback for every other provider
// ---------------------------------------------------------------------------

/**
 * Cantonese wellbeing phrases.
 *
 * Split by severity rather than lumped together because the routing differs:
 * danger pages a human immediately, worrying opens a case without an urgent
 * page, and anything unrecognised is treated as unclear so a human looks at it.
 *
 * Each list carries both the Cantonese wording and the Mandarin/simplified
 * wording that speech recognition may return for it — see
 * {@link normalizeCantonese} for why both are needed. Keeping both in the data
 * means a reader can see the full vocabulary the classifier accepts without
 * having to reason about the normalisation step.
 *
 * Kept as data at module scope so the tests can assert on them directly.
 */
export const DANGER_PHRASES = [
  // Cantonese
  "救命", "救救我", "幫我", "幫吓我", "好痛", "好痛呀", "胸口痛", "呼吸唔到",
  "喘唔到氣", "跌落", "跌親", "跌低", "企唔到", "企唔起身", "暈低",
  // Homophone drift — the recogniser heard a different but identical-sounding
  // character, not a Mandarin rendering: 幫吓我 came back as 幫下我 (吓/下, both
  // haa5). Measured against the real clips; see the homophone rows in FORM_PAIRS.
  "幫下我",
  // Mandarin / simplified renderings Whisper's zh output can produce
  "帮我", "帮我一下", "好疼", "胸痛", "呼吸不到", "喘不過氣", "喘不过气",
  "跌倒", "摔倒", "站不住", "站不起來", "站不起来", "暈倒", "晕倒",
] as const;

export const WORRY_PHRASES = [
  // Cantonese
  "唔舒服", "唔妥", "有啲痛", "頭暈", "頭痛", "暈", "攰", "冇力", "冇乜力",
  "冇力氣", "冇乜力氣", "冇胃口", "食唔落", "瞓唔著", "失眠", "唔開心",
  "寂寞", "悶", "驚", "擔心", "咳",
  // Mandarin / simplified renderings Whisper's zh output can produce.
  // 「睡不著」and「不開心」are here as well as in normalised form because
  // normalising them yields 睡唔著/唔开心, which are not themselves listed.
  "不舒服", "不妥", "有點痛", "有点痛", "头晕", "头痛", "累", "沒力", "没力",
  "沒力氣", "没力气", "沒胃口", "没胃口", "吃不下", "睡不著", "睡不着",
  "不開心", "不开心", "害怕",
  // Negations of wellbeing. Substring matching alone reads the 「幾好」 inside
  // 「唔係幾好」and would report a struggling elder as safe, so these are listed
  // as worrying and matched before the SAFE list.
  "唔係幾好", "唔係好", "唔太好", "唔算好", "不太好", "不好", "不是很好",
  "不是幾好",
] as const;

export const SAFE_PHRASES = [
  // Cantonese
  "冇事", "冇乜事", "幾好", "幾好呀", "幾精神", "好好", "我好好", "好呀",
  "安好", "精神", "唔使", "冇問題", "OK", "ok",
  // Homophone drift — the recogniser heard a different but identical-sounding
  // character, not a Mandarin rendering: 好呀 came back as 好啊 (呀/啊, both aa3)
  // and 唔使 as 唔洗 (使/洗, both sai2). Measured; see the homophone rows in
  // FORM_PAIRS. 好痛呀 and 幾好呀 need no variant here: 好痛 and 幾好 already
  // match them as substrings.
  "好啊", "唔洗",
  // Mandarin / simplified renderings Whisper's zh output can produce.
  // Deliberately no bare 「很好」/「挺好」: 「不是很好」would then contain it and
  // be reported as safe. Only unambiguous wellbeing statements belong here.
  "沒事", "没事", "沒什麼事", "没什么事", "沒問題", "没问题", "我很好", "還好",
  "还好",
] as const;

/**
 * Rewrite the Mandarin forms Whisper emits back into the Cantonese the phrase
 * lists are written in.
 *
 * Why this exists — measured, not assumed. The eight real clips in
 * `public/audio/` were transcribed through the local faster-whisper server
 * (model `small`, `language=zh`) and the same speaker came back in both
 * languages: 「我冇事」 as 「我没事」, 「唔係真人」 as 「不是真人」, 「你嘅家人」
 * as 「你的家人」. Whisper drifts to Mandarin vocabulary while keeping
 * traditional characters. Without this step a real 「我冇事」 that arrives as
 * 「我没事」 matches nothing and is filed as `unclear`; in the worry and danger
 * direction the same drift silently downgrades a distress signal.
 *
 * The mapping is deliberately narrow — only the four substitutions measured to
 * occur, each sense-preserving (negator to negator, copula to copula, possessive
 * to possessive). It is NOT a Mandarin->Cantonese translator. Anything it does
 * not cover must fall through to `unclear`, never to `safe`. Because every
 * replacement only rewrites a particle into the form the lists already use, and
 * never removes a character, normalisation cannot invent a wellbeing match that
 * the original text did not contain.
 *
 * Known limit, unchanged by this function: matching is substring-based, so a
 * doubly-negated phrase such as 「不是沒事」 still matches 「沒事」. Guarding that
 * properly needs a parser, not a list.
 */
export function normalizeCantonese(heard: string): string {
  return heard
    .replace(/[沒没]/g, "冇")
    .replace(/不/g, "唔")
    .replace(/是/g, "係")
    .replace(/的/g, "嘅");
}

/**
 * Deterministic classification. This is the safety floor: it is what runs when
 * there is no LLM, when the LLM errors, and when the LLM returns something
 * unparseable. It never guesses in the direction of "safe".
 */
export function classifyCantonese(heard: string): Outcome {
  const raw = heard.trim();
  if (!raw) return "unclear";

  // Match against the text as recognised AND as normalised to Cantonese, so a
  // phrase is found whether it arrived in Cantonese or in Whisper's Mandarin
  // rendering. The raw form is kept because normalisation cannot reach every
  // Mandarin variant (「累」/「吃不下」/「睡不著」have no Cantonese character to
  // map from); the normalised form covers the particle drift.
  const forms = [normalizeCantonese(raw), raw];
  const has = (phrases: readonly string[]) =>
    phrases.some((p) => forms.some((f) => f.includes(p)));

  // Danger is checked first, so "唔舒服...但冇事" still routes to a human, and
  // the order danger > worrying > safe is what keeps a reassurance from
  // outranking a symptom.
  if (has(DANGER_PHRASES)) return "danger";
  if (has(WORRY_PHRASES)) return "worrying";
  if (has(SAFE_PHRASES)) return "safe";
  return "unclear";
}

export function createOfflineConversationEngine(): ConversationEngine {
  return {
    name: "offline",
    async understand(state) {
      return classifyCantonese(state.heard);
    },
    async reply() {
      // The scripted lines in src/lib/script.ts are the source of truth for
      // wording; returning "" tells the caller to use them.
      return "";
    },
  };
}

// ---------------------------------------------------------------------------
// Groq — free, OpenAI-compatible
// ---------------------------------------------------------------------------

/**
 * Groq's free tier. A single key covers both directions:
 *   - speech recognition via whisper-large-v3 (see voice.ts)
 *   - the conversational line via an instruction-tuned Llama
 *
 * That single-key property is why Groq is the default suggestion: one signup,
 * no credit card, and both halves of the voice loop work.
 */
export const GROQ_CHAT_DEFAULTS = {
  endpoint: "https://api.groq.com/openai/v1/chat/completions",
  model: "llama-3.3-70b-versatile",
} as const;

export type GroqConversationConfig = {
  apiKey: string;
  model?: string | undefined;
  /** Abort a slow request rather than leave the elder in silence. */
  timeoutMs?: number | undefined;
};

/** The rulebook given to the model. Kept short — long prompts get ignored. */
const SYSTEM_PROMPT = `You are the voice of an automated wellbeing check-in call for an elderly Cantonese speaker in Hong Kong. The person on the line may be frail, hard of hearing, or distressed.

Rules you must follow:
1. Reply in spoken Cantonese, using everyday Hong Kong wording. Never use written Chinese, Mandarin, or English words when a Cantonese word exists.
2. At most two short sentences. This is read aloud, so no lists, no markdown, no emoji.
3. Be warm and unhurried. Never sound like a form being filled in.
4. You do not decide anything. If the person describes pain, a fall, breathing trouble, dizziness, or says they need help, say you are getting a person to help them right away and tell them to call 999 if it is urgent.
5. Never tell someone they are fine, and never reassure them that a symptom is nothing to worry about.
6. If you did not understand, ask once more, gently.`;

export function createGroqConversationEngine(cfg: GroqConversationConfig): ConversationEngine {
  const model = cfg.model ?? GROQ_CHAT_DEFAULTS.model;
  const timeoutMs = cfg.timeoutMs ?? 6000;

  /** One chat call. Returns null on any failure — never throws. */
  async function chat(messages: { role: string; content: string }[]): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(GROQ_CHAT_DEFAULTS.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, messages, temperature: 0.4, max_tokens: 160 }),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const text = json.choices?.[0]?.message?.content;
      return typeof text === "string" ? text.trim() : null;
    } catch {
      // Timeout, offline, rate-limited, malformed — all the same to the caller.
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    name: "groq-llama",

    async understand(state) {
      // The deterministic answer is computed first and is always the fallback.
      const fallback = classifyCantonese(state.heard);
      // A hard rule beats asking the model: if the phrase is a known
      // emergency, do not spend a round trip, and do not risk it being
      // reclassified downward.
      if (fallback === "danger") return "danger";
      if (!state.heard.trim()) return fallback;

      const verdict = await chat([
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            `The elder was asked how they are today and answered: "${state.heard}"\n\n` +
            `Classify their wellbeing as exactly one word:\n` +
            `- danger: a fall, chest pain, trouble breathing, or they asked for help\n` +
            `- worrying: discomfort, pain, dizziness, low mood, or anything not clearly fine\n` +
            `- safe: they clearly said they are well\n` +
            `- unclear: you cannot tell\n` +
            `Reply with one word only.`,
        },
      ]);

      const word = (verdict ?? "").toLowerCase().match(/\b(danger|worrying|safe|unclear)\b/)?.[1];
      // Anything the model did not answer cleanly falls back rather than being
      // trusted — and "safe" is never taken from the model unless the
      // deterministic classifier also found a wellbeing phrase.
      if (!word) return fallback;
      if (word === "safe" && fallback !== "safe") return fallback;
      return word as Outcome;
    },

    async reply(state) {
      const turns = state.history
        .slice(-6)
        .map((h) => `${h.role === "assistant" ? "Assistant" : state.elderName}: ${h.text}`)
        .join("\n");
      const text = await chat([
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            `Name of the person you are calling: ${state.elderName}\n` +
            (turns ? `\nConversation so far:\n${turns}\n` : "") +
            (state.heard ? `\nThey just said: "${state.heard}"\n` : "") +
            `\nWrite the single next thing you say.`,
        },
      ]);
      return text ?? "";
    },
  };
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/** Chooses the engine from env; the offline script by default. */
export function selectConversationEngine(
  env: Record<string, string | undefined>,
): ConversationEngine {
  const groqKey = env["GROQ_API_KEY"] ?? env["VITE_GROQ_API_KEY"];
  if (groqKey) return createGroqConversationEngine({ apiKey: groqKey });
  return createOfflineConversationEngine();
}
