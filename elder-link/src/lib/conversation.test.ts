/**
 * Tests for the conversational layer.
 *
 * The two properties worth guarding are safety properties, not features:
 *
 *   1. A mishearing can never be recorded as "safe". It is far worse to close
 *      a case on a frail person than to open one unnecessarily.
 *   2. An LLM outage degrades the call rather than breaking it, and cannot
 *      downgrade a recognised emergency.
 *
 * Both are asserted here, including against a *hostile* mock that always
 * answers "safe".
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  classifyCantonese,
  createGroqConversationEngine,
  createOfflineConversationEngine,
  selectConversationEngine,
  normalizeCantonese,
  DANGER_PHRASES,
  WORRY_PHRASES,
  SAFE_PHRASES,
} from "@/lib/conversation";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A fetch that always returns the given assistant text. */
function stubChat(content: string, opts: { status?: number } = {}) {
  vi.stubGlobal("fetch", async () => ({
    ok: (opts.status ?? 200) < 400,
    status: opts.status ?? 200,
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => content,
  }));
}

/** A fetch that fails, to simulate an outage. */
function stubFailure() {
  vi.stubGlobal("fetch", async () => {
    throw new Error("network down");
  });
}

describe("deterministic classifier (the safety floor)", () => {
  it("returns unclear for silence", () => {
    expect(classifyCantonese("")).toBe("unclear");
    expect(classifyCantonese("   ")).toBe("unclear");
  });

  it("returns unclear for anything unrecognised, never safe", () => {
    for (const junk of ["????", "hello there", "睇下電視", "123", "呀"]) {
      expect(classifyCantonese(junk)).toBe("unclear");
    }
  });

  it("routes every danger phrase to danger", () => {
    for (const p of DANGER_PHRASES) {
      expect(classifyCantonese(`我${p}呀`)).toBe("danger");
    }
  });

  it("recognises safe phrases", () => {
    for (const p of SAFE_PHRASES) {
      expect(classifyCantonese(`我${p}`)).toBe("safe");
    }
  });

  it("treats danger as dominant over a reassurance in the same breath", () => {
    // "I fell but I'm fine" must still reach a human.
    expect(classifyCantonese("我跌親，不過冇事")).toBe("danger");
  });

  it("treats discomfort as worrying rather than safe", () => {
    expect(classifyCantonese("有啲頭暈")).toBe("worrying");
    expect(classifyCantonese("食唔落飯")).toBe("worrying");
  });
});

/**
 * A phrase -> the variant Whisper may return for the same utterance. Both
 * members must classify identically.
 *
 * Most rows are Cantonese -> Mandarin/simplified renderings. The homophone rows
 * (吓/下, 呀/啊, 使/洗) are a different failure mode measured on the real clips:
 * the recogniser returned a different word that sounds the same rather than a
 * Mandarin one, so `normalizeCantonese` cannot reach it — only a list entry can.
 *
 * Entries whose Mandarin form is reachable purely through `normalizeCantonese`
 * (the 沒/不/是/的 substitutions) duplicate their list entry by design — the
 * brief asked for both mechanisms. The rest — 累, 吃不下, 睡不著, 站不住, 跌倒,
 * 我很好, 還好 — are reachable only through their list entry, because
 * normalisation has no Cantonese character to map them from; deleting those
 * entries fails the test below.
 */
const FORM_PAIRS: ReadonlyArray<
  readonly [string, string, "danger" | "worrying" | "safe"]
> = [
  // safe
  ["冇事", "沒事", "safe"],
  ["冇乜事", "沒什麼事", "safe"],
  ["冇問題", "沒問題", "safe"],
  ["我好好", "我很好", "safe"],
  ["幾好", "還好", "safe"],
  // safe — homophone drift (呀/啊, 使/洗)
  ["好呀", "好啊", "safe"],
  ["唔使", "唔洗", "safe"],
  // worrying
  ["唔舒服", "不舒服", "worrying"],
  ["冇力", "沒力", "worrying"],
  ["冇乜力", "沒力氣", "worrying"],
  ["食唔落", "吃不下", "worrying"],
  ["瞓唔著", "睡不著", "worrying"],
  ["攰", "累", "worrying"],
  ["唔開心", "不開心", "worrying"],
  // danger
  ["呼吸唔到", "呼吸不到", "danger"],
  ["企唔到", "站不住", "danger"],
  ["跌親", "跌倒", "danger"],
  ["暈低", "暈倒", "danger"],
  // danger — homophone drift (吓/下)
  ["幫吓我", "幫下我", "danger"],
];

/**
 * Whisper renders Cantonese inconsistently: the same speaker comes back in
 * Cantonese for one clip and Mandarin for the next. These tests pin that down
 * using the strings actually observed from the local server on the real clips in
 * `public/audio/`, plus the Mandarin rendering of every other phrase.
 */
describe("classifier is robust to Whisper's Mandarin rendering", () => {
  it("normalises the measured Mandarin forms back to Cantonese", () => {
    expect(normalizeCantonese("我没事")).toBe("我冇事");
    expect(normalizeCantonese("不是真人")).toBe("唔係真人");
    expect(normalizeCantonese("你的家人")).toBe("你嘅家人");
    expect(normalizeCantonese("不舒服")).toBe("唔舒服");
    // Already Cantonese — must pass through untouched.
    expect(normalizeCantonese("我冇事")).toBe("我冇事");
  });

  it("classifies the real measured clips the way the elder meant them", () => {
    // Verbatim from the local server's output on public/audio/*.mp3.
    expect(classifyCantonese("沒事")).toBe("safe"); // ask.mp3 said 冇事
    expect(classifyCantonese("不舒服")).toBe("worrying"); // ask.mp3 said 唔舒服
    expect(classifyCantonese("唔太清楚")).toBe("unclear"); // unclear.mp3, unchanged
    // Not wellbeing statements — must never be read as safe.
    expect(classifyCantonese("不是真人")).toBe("unclear"); // disclosure.mp3
    expect(classifyCantonese("你的家人")).toBe("unclear"); // worry.mp3
  });

  it("classifies every listed phrase the way its own list expects", () => {
    for (const p of DANGER_PHRASES) expect(classifyCantonese(p), `${p} -> danger`).toBe("danger");
    for (const p of WORRY_PHRASES) expect(classifyCantonese(p), `${p} -> worrying`).toBe("worrying");
    for (const p of SAFE_PHRASES) expect(classifyCantonese(p), `${p} -> safe`).toBe("safe");
  });

  it("classifies both the Cantonese and Mandarin form of the same phrase", () => {
    for (const [yue, zh, expected] of FORM_PAIRS) {
      expect(classifyCantonese(yue), `${yue} should be ${expected}`).toBe(expected);
      expect(classifyCantonese(zh), `${zh} should be ${expected}`).toBe(expected);
    }
  });

  it("never reports safe for a negated wellbeing phrase", () => {
    // 「唔係幾好」contains 「幾好」; substring matching alone would call it safe.
    for (const negated of [
      "唔係幾好", "我唔係幾好", "唔係好", "唔太好", "不太好", "不好",
      "不是很好", "不是幾好", "我唔舒服", "唔太清楚", "睇下電視",
    ]) {
      expect(classifyCantonese(negated), `${negated} must not be safe`).not.toBe("safe");
    }
  });
});

describe("offline conversation engine", () => {
  it("classifies without any network access", async () => {
    const engine = createOfflineConversationEngine();
    await expect(
      engine.understand({ elderName: "陳婆婆", heard: "救命呀", history: [] }),
    ).resolves.toBe("danger");
    await expect(
      engine.understand({ elderName: "陳婆婆", heard: "我冇事", history: [] }),
    ).resolves.toBe("safe");
  });

  it("returns an empty reply so the script supplies the wording", async () => {
    const engine = createOfflineConversationEngine();
    await expect(
      engine.reply({ elderName: "陳婆婆", heard: "我冇事", history: [] }),
    ).resolves.toBe("");
  });
});

describe("groq conversation engine — safety", () => {
  it("cannot be talked into calling an emergency safe", async () => {
    // A hostile/broken model that answers "safe" to a distress call.
    stubChat("safe");
    const engine = createGroqConversationEngine({ apiKey: "test" });
    const o = await engine.understand({
      elderName: "陳婆婆",
      heard: "我跌親，好痛",
      history: [],
    });
    expect(o).toBe("danger");
  });

  it("does not accept safe unless the deterministic floor also found it", async () => {
    stubChat("safe");
    const engine = createGroqConversationEngine({ apiKey: "test" });
    // Unrecognised by the floor → must stay unclear even though the model said safe.
    const o = await engine.understand({
      elderName: "陳婆婆",
      heard: "今日天氣唔錯",
      history: [],
    });
    expect(o).toBe("unclear");
  });

  it("accepts safe when the floor agrees", async () => {
    stubChat("safe");
    const engine = createGroqConversationEngine({ apiKey: "test" });
    await expect(
      engine.understand({ elderName: "陳婆婆", heard: "我冇事", history: [] }),
    ).resolves.toBe("safe");
  });

  it("allows the model to upgrade unclear to worrying", async () => {
    stubChat("worrying");
    const engine = createGroqConversationEngine({ apiKey: "test" });
    await expect(
      engine.understand({ elderName: "陳婆婆", heard: "今日個人有啲攰攰地", history: [] }),
    ).resolves.toBe("worrying");
  });

  it("falls back to the floor when the network fails", async () => {
    stubFailure();
    const engine = createGroqConversationEngine({ apiKey: "test" });
    await expect(
      engine.understand({ elderName: "陳婆婆", heard: "我跌親", history: [] }),
    ).resolves.toBe("danger");
    await expect(
      engine.understand({ elderName: "陳婆婆", heard: "唔知道呀", history: [] }),
    ).resolves.toBe("unclear");
  });

  it("falls back when the model returns a non-answer", async () => {
    stubChat("I'm sorry, I can't help with that.");
    const engine = createGroqConversationEngine({ apiKey: "test" });
    await expect(
      engine.understand({ elderName: "陳婆婆", heard: "我冇事", history: [] }),
    ).resolves.toBe("safe");
  });

  it("falls back on an HTTP error", async () => {
    stubChat("", { status: 429 });
    const engine = createGroqConversationEngine({ apiKey: "test" });
    await expect(
      engine.understand({ elderName: "陳婆婆", heard: "救命", history: [] }),
    ).resolves.toBe("danger");
  });

  it("returns an empty reply on failure rather than throwing", async () => {
    stubFailure();
    const engine = createGroqConversationEngine({ apiKey: "test" });
    await expect(
      engine.reply({ elderName: "陳婆婆", heard: "我冇事", history: [] }),
    ).resolves.toBe("");
  });

  it("returns the model's line when it works", async () => {
    stubChat("好呀，聽到你咁講我就放心喇。");
    const engine = createGroqConversationEngine({ apiKey: "test" });
    await expect(
      engine.reply({ elderName: "陳婆婆", heard: "我冇事", history: [] }),
    ).resolves.toBe("好呀，聽到你咁講我就放心喇。");
  });
});

describe("engine selection", () => {
  it("uses the offline engine with no key configured", () => {
    expect(selectConversationEngine({}).name).toBe("offline");
  });

  it("uses groq when a key is present, under either variable name", () => {
    expect(selectConversationEngine({ GROQ_API_KEY: "k" }).name).toBe("groq-llama");
    expect(selectConversationEngine({ VITE_GROQ_API_KEY: "k" }).name).toBe("groq-llama");
  });
});
