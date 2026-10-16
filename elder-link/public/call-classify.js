// Matches a spoken Cantonese answer to one of the four script options.
//
// Mirrors classifyCantonese() in src/lib/conversation.ts and classifySpoken()
// in src/components/CantoneseDemoCall.tsx — same keyword sets, same order of
// precedence, same safety invariant. Kept in plain JS so the standalone phone
// call screen needs no build step.
//
// THE INVARIANT: a phrase that is not clearly understood must NEVER be
// classified as a benign answer. Unrecognised speech returns null, and the
// caller escalates rather than guessing. A false "she's fine" is the one
// failure this whole system exists to prevent.

/** Words that mean immediate danger. Checked first, always. */
const DANGER = [
  "救命", "幫我", "好痛", "痛", "呼吸", "透唔到氣", "透不到气",
  "心口", "跌親", "跌倒", "跌落", "起唔到身", "郁唔到",
];

/** Words that mean unwell / worrying. */
const WORRY = [
  // Cantonese
  "唔舒服", "唔妥", "有啲痛", "頭暈", "頭痛", "暈", "攰", "冇力", "冇力氣",
  "冇胃口", "食唔落", "瞓唔著", "唔開心", "寂寞", "悶", "驚", "咳", "喉嚨痛",
  "發燒", "虛弱",
  // Mandarin / simplified renderings the recogniser can emit.
  "不舒服", "不妥", "有點痛", "有点痛", "头晕", "头痛", "累", "沒力", "没力",
  "沒力氣", "没力气", "沒胃口", "没胃口", "吃不下", "睡不著", "睡不着",
  "不開心", "不开心", "害怕", "发烧", "虚弱",
  // Negations of wellbeing, listed in full on purpose.
  //
  // 「唔係幾舒服」 does NOT contain the contiguous substring 「唔舒服」 — an
  // 「係幾」 sits between them — so it needs its own entry. The same is true of
  // 「唔係幾好」 versus 「幾好」: without these, substring search would find the
  // 「幾好」 and report a struggling elder as safe. They are checked before the
  // SAFE list, which is what keeps the floor intact.
  "唔係幾舒服", "唔係幾好", "唔係好", "唔太舒服", "唔多舒服", "唔太",
  "唔太好", "唔算好", "不太好", "不好", "不是很好", "不是幾好", "不係幾舒服",
];

/** Words that mean genuinely fine. */
const SAFE = [
  "冇事", "没事", "幾好", "几好", "好好", "安好", "唔使", "冇問題",
  "没问题", "ok", "OK",
];

/** Danger phrases that are unambiguous on their own. */
const HARD_DANGER = ["救命", "幫我", "好痛", "呼吸", "透唔到氣", "起唔到身"];

/**
 * Words that appear in an option's wording but carry no signal about which
 * option was chosen.
 *
 * The 「唔知」 case is why this exists. S4's fourth option is 「唔……唔知呀……」,
 * whose whole meaning is "I don't know" — but scored naively its 「知」 alone
 * hits, and because every *other* S4 option is phrased in the first person
 * ("我喺廁所…"), a bare 「唔知呀」 scored highest on it. The caller would then
 * announce a fall to someone who had just said she didn't know what was wrong.
 * Uncertain is a state the graph handles (S12 repeats, then escalates), so
 * option matching must decline rather than guess.
 */
const NON_SIGNAL = new Set([
  "唔知", "不知道", "唔清楚", "不清楚", "唔明", "唔記得", "唔太", "唔係",
  "幾", "有", "冇", "唔", "我", "你", "佢", "都", "好", "呀", "啦",
  "嘅", "係", "咁", "啲", "同", "先", "而", "家", "今日", "其實", "不過",
]);

/**
 * True when a phrase carries no answer at all — the elder did not understand,
 * does not know, or said nothing. The graph already has a state for this
 * (S12 repeats, then S14 escalates), so option matching must decline.
 */
function isNonAnswer(t) {
  const core = t.replace(/[唔不]/g, "");
  return ["知", "清楚", "明白", "明", "記得", "記得", "識"].some((w) =>
    t.includes("唔" + w),
  ) && core.length <= 4;
}

function norm(t) {
  return t
    .replace(/[\s，。！？、,.!?]/g, "")
    .replace(/沒|没/g, "冇")
    .replace(/不/g, "唔")
    .replace(/是/g, "係")
    .replace(/的/g, "嘅")
    .toLowerCase();
}

/**
 * Classify a free-text Cantonese answer.
 *
 * Returns one of: "danger" | "worrying" | "safe" | "unclear".
 * Never returns "safe" unless a safe phrase was actually heard.
 */
export function classifyCantonese(text) {
  const t = norm(text);
  if (!t) return "unclear";
  if (HARD_DANGER.some((w) => t.includes(norm(w)))) return "danger";
  if (DANGER.some((w) => t.includes(norm(w)))) return "worrying";
  if (WORRY.some((w) => t.includes(norm(w)))) return "worrying";
  if (SAFE.some((w) => t.includes(norm(w)))) return "safe";
  return "unclear";
}

/**
 * Pick which option of a section the elder's words best match.
 *
 * Each option is split into content words and scored by how many of them
 * appear in what was said. A word only counts if it is specific enough to
 * identify this option: single characters and the items in NON_SIGNAL carry no
 * weight, and the option's own 「我」/「都」/「呀」 fillers are dropped.
 *
 * Returns the option's index, or -1 when nothing matches — which the caller
 * treats as "unclear", never as a default. Declining to guess is the correct
 * outcome: S12 repeats the question and S14 escalates, whereas a wrong guess
 * puts words in the elder's mouth about her own health.
 */
export function matchOption(heard, opts) {
  const t = norm(heard);
  if (!t) return -1;
  // "I don't know" is not an answer. Guessing here would put words in the
  // elder's mouth about her own health; S12 handles it properly.
  if (isNonAnswer(t)) return -1;
  let best = -1;
  let bestScore = 0;
  opts.forEach((opt, i) => {
    // Split the Chinese side into runs of Han characters. The English is
    // dropped here: the elder speaks Cantonese.
    const runs = norm(opt.zh).split(/[^\u4e00-\u9fff]+/).filter(Boolean);
    // Fragments shared with a sibling option are not evidence for either, so
    // they are collected once and excluded below.
    const siblingRuns = opts.filter((_, j) => j !== i).map((o) => norm(o.zh));
    let score = 0;
    for (const run of runs) {
      // Longest word first, so 「唔係幾舒服」 counts once as a strong signal
      // rather than being counted again through its shorter fragments.
      for (let start = 0; start < run.length; start++) {
        const remaining = run.slice(start);
        if (NON_SIGNAL.has(remaining)) break;
        if (siblingRuns.some((s) => s.includes(remaining))) break;
        if (t.includes(remaining)) {
          score += remaining.length * 2;
          break;
        }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  // Require a real signal: one incidental character is not an answer.
  return bestScore >= 4 ? best : -1;
}

/**
 * Shorten a transcript to the phrases worth re-reading on screen.
 * Kept tiny deliberately: the note recorded for staff is a short phrase, never
 * a transcript, matching the script's "no audio or transcript is kept" rule.
 */
export function briefNote(text, limit = 40) {
  const t = (text || "").trim();
  return t.length <= limit ? t : t.slice(0, limit) + "…";
}
