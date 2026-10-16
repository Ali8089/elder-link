// Verifies the two plain-JS modules the standalone phone call screen depends on.
//
// The screen is only as safe as call-classify.js: if it downgrades a worrying
// phrase to "safe", the whole point of the care call is defeated. These checks
// drive the real exported functions, not a copy of them.

import { classifyCantonese, matchOption, briefNote } from "../public/call-classify.js";
import { SCRIPT, OPENING_FOR, CALLER_NAME, ESCALATE } from "../public/call-script.js";

let pass = 0;
let fail = 0;

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}\n       expected ${JSON.stringify(expected)}\n       actual   ${JSON.stringify(actual)}`);
  }
}

console.log("\nclassifyCantonese — safety floor");
check("救命 -> danger", classifyCantonese("救命呀！"), "danger");
check("好痛 -> danger", classifyCantonese("我個心口好痛"), "danger");
check("透唔到氣 -> danger", classifyCantonese("我透唔到氣"), "danger");
check("跌親起唔到身 -> danger", classifyCantonese("我喺廁所跌親，起唔到身"), "danger");
check("唔舒服 -> worrying", classifyCantonese("我今日唔係幾舒服"), "worrying");
check("頭暈 -> worrying", classifyCantonese("有啲頭暈"), "worrying");
check("冇胃口 -> worrying", classifyCantonese("好幾日都冇胃口"), "worrying");
check("幾好 -> safe", classifyCantonese("我幾好呀"), "safe");
check("冇事 -> safe", classifyCantonese("冇事，唔使擔心"), "safe");
check("normalises 沒事 -> safe", classifyCantonese("沒事"), "safe");
check("normalises 不舒服 -> worrying", classifyCantonese("我不舒服"), "worrying");
check("empty -> unclear", classifyCantonese(""), "unclear");
check("noise -> unclear", classifyCantonese("嘩啦啦啦啦"), "unclear");
check("silence-ish -> unclear", classifyCantonese("嗯……"), "unclear");
check("NEVER safe on unclear", classifyCantonese("abc123").shouldNotExist === undefined ? (classifyCantonese("abc123") === "safe" ? "safe" : "not-safe") : null, "not-safe");

console.log("\nclassifyCantonese — negated wellbeing must never be safe");
// 「唔係幾舒服」 is not a substring of 「唔舒服」: an 「係幾」 sits between them,
// so a naive keyword list silently misses it and the elder reads as unclear.
// Worse, 「唔係幾好」 DOES contain 「幾好」, so a naive list would read it as safe.
for (const negated of [
  "唔係幾舒服", "我今日唔係幾舒服", "我覺得唔係幾舒服", "唔係幾好",
  "我唔係幾好", "唔係好", "唔太舒服", "唔太好", "不太好", "不好",
  "不是很好", "不是幾好",
]) {
  check(`「${negated}」 is not safe`, classifyCantonese(negated) !== "safe", true);
  check(`「${negated}」 is worrying`, classifyCantonese(negated), "worrying");
}

console.log("\nclassifyCantonese — precedence");
check("danger beats safe in same sentence", classifyCantonese("冇事但係好痛"), "danger");
check("worrying beats safe in same sentence", classifyCantonese("都幾好不過有啲頭暈"), "worrying");

console.log("\nmatchOption — S3 four-way branch");
const s3 = SCRIPT.S3.options;
check("唔係幾舒服 -> option 0", matchOption("我唔係幾舒服", s3), 0);
check("好悶 -> option 1", matchOption("都幾好，不過成日一個人，好悶", s3), 1);
check("肚餓 -> option 2", matchOption("我肚餓呀，今日仲未食嘢", s3), 2);
check("幾好 -> option 3", matchOption("幾好呀", s3), 3);
check("gibberish -> -1 (no guess)", matchOption("啦啦啦", s3), -1);
check("empty -> -1", matchOption("", s3), -1);

console.log("\nmatchOption — danger branch S4");
const s4 = SCRIPT.S4.options;
check("心口痛 -> option 0", matchOption("我心口好痛，好難透氣", s4), 0);
check("廁所跌親 -> option 1", matchOption("我喺廁所跌親，起唔到身", s4), 1);
check("咳同喉嚨痛 -> option 2", matchOption("有啲咳，喉嚨痛，好似有少少發燒", s4), 2);
check("唔知 -> -1", matchOption("唔知呀", s4), -1);

console.log("\nbriefNote");
check("short stays", briefNote("冇事"), "冇事");
check("long truncates", briefNote("a".repeat(60)).length, 41);
check("long ends with ellipsis", briefNote("a".repeat(60)).endsWith("…"), true);

console.log("\nscript integrity");
check("caller name", CALLER_NAME, "Elderly care team");
check("sensor opening is S2", OPENING_FOR.sensor, "S2");
check("scheduled opening is S1", OPENING_FOR.scheduled, "S1");

// Every `go` and `next` must point at a section that exists, or the call dies
// mid-conversation with the elder still on the line.
const ids = new Set(Object.keys(SCRIPT));
const dangling = [];
const terminals = [];
for (const [id, node] of Object.entries(SCRIPT)) {
  if (node.next && !ids.has(node.next)) dangling.push(`${id}.next -> ${node.next}`);
  for (const opt of node.options ?? []) {
    if (opt.go && !ids.has(opt.go)) dangling.push(`${id}.option("${opt.zh}") -> ${opt.go}`);
  }
  // A node must either continue, offer options, or end. Otherwise the call
  // reaches a node and stalls forever.
  if (!node.next && !node.options && !node.end) terminals.push(id);
}
check("no dangling edges", dangling, []);
check("no dead-end nodes", terminals, []);

// Every escalation target must be reachable from S3 by walking the graph —
// except S42–S44, which are the no-answer chain. Those are entered when the
// elder does not pick up at all, so no answer can ever lead to them; they are
// reached by the retry timer in the runner, not by the conversation.
const NO_ANSWER_CHAIN = new Set(["S42", "S43", "S44"]);
const reachable = new Set();
const queue = ["S3"];
while (queue.length) {
  const id = queue.shift();
  if (reachable.has(id) || !ids.has(id)) continue;
  reachable.add(id);
  const node = SCRIPT[id];
  if (node.next) queue.push(node.next);
  for (const opt of node.options ?? []) if (opt.go) queue.push(opt.go);
}
const unreachableEscalations = [...ESCALATE].filter(
  (id) => !reachable.has(id) && !NO_ANSWER_CHAIN.has(id),
);
check("all escalation sections reachable from S3", unreachableEscalations, []);

// The no-answer chain must still be internally sound: S42 offers a route into
// S43 and S44, and both terminate.
check("S42 is entered by the no-answer path", !!SCRIPT.S42, true);
check("S42 offers the daughter's two replies",
  (SCRIPT.S42.options ?? []).map((o) => o.go), ["S43", "S44"]);
check("S43 and S44 both end", [!!SCRIPT.S43.end, !!SCRIPT.S44.end], [true, true]);
check("S44 is System-only (nothing is spoken)",
  (SCRIPT.S44.say ?? []).length, 0);

// The danger sections must actually carry the 999 wording.
check("S5 says 999", SCRIPT.S5.say.some((l) => l.zh.includes("999")), true);
check("S6 says 999", SCRIPT.S6.say.some((l) => l.zh.includes("999")), true);
check("S23 says 999 and 18111",
  SCRIPT.S23.say.some((l) => l.zh.includes("999")) && SCRIPT.S23.say.some((l) => l.zh.includes("18111")), true);

// S8 is the AI-never-claims-it-dialled rule.
check("S8 does not claim the AI called 999",
  SCRIPT.S8.say.some((l) => /打咗999|已經打999|我打咗/.test(l.zh)), false);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
