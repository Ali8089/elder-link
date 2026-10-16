// Generates both copies of the care-call script from the source markdown.
//
//   node scripts/gen-script-from-md.mjs
//
// Input:  ElderLink_Call_Script.md   (S1–S44, bilingual)
// Output: src/lib/script.ts          (CARE_SCRIPT, for the React app)
//         public/call-script.js      (SCRIPT, for the standalone phone page)
//
// Why generate rather than hand-write: the tree already existed in two places
// and they had drifted by 40 differences and 3 missing sections. Editing a 44-
// section branching script by hand in two languages is exactly the kind of work
// that goes wrong quietly, and a wrong tree means the caller says the wrong
// thing to a vulnerable person. The markdown is the single source of truth.
//
// The existing prose in both output files (header comments, the flat
// CALL_SCRIPT, audio maps, helpers) is preserved: only the generated blocks are
// replaced, between explicit BEGIN/END markers.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const SRC = process.argv[2] ?? "C:/Users/user/OneDrive/Desktop/ElderLink_Call_Script.md";

const md = readFileSync(SRC, "utf8").replace(/\r\n/g, "\n");

/* ------------------------------------------------------------ parse the md */

/**
 * Splits the markdown into sections keyed by id.
 *
 * Only `### S<n>` headings start a section. Content is classified by marker:
 *   **AI:** …            a spoken line (zh line, then the en line under it)
 *   Elder options: …     a bullet list of answers with → targets
 *   Reply options: …     same, used by the escalation sections
 *   > System …           a dashboard note, not spoken
 *   → continue to S<n>   the next section when there is nothing to wait for
 *   *End of call.*       the call finishes
 */
function parse() {
  const lines = md.split("\n");
  const sections = new Map();
  let cur = null;
  let mode = "prose";

  const heading = (t) => t.match(/^###\s+(S\d+)\s*(?:·\s*(.*))?$/);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();

    const h = heading(t);
    if (h) {
      cur = {
        id: h[1],
        title: (h[2] ?? "").trim(),
        say: [],
        options: [],
        next: null,
        end: false,
        ask: null,
        system: [],
      };
      sections.set(cur.id, cur);
      mode = "prose";
      continue;
    }
    if (!cur) continue;

    if (/^##\s/.test(t)) { cur = null; continue; }              // a new top-level block
    if (/^(Elder options:|Reply options:)/.test(t)) { mode = "opts"; continue; }
    if (/^→\s*continue to\s*(S\d+)/.test(t)) {
      cur.next = t.match(/^→\s*continue to\s*(S\d+)/)[1];
      mode = "prose";
      continue;
    }
    if (/^\*End of call\.\*/.test(t)) { cur.end = true; mode = "prose"; continue; }
    if (/^>/.test(t)) { cur.system.push(t.replace(/^>\s*/, "")); mode = "prose"; continue; }
    if (!t) continue;

    if (mode === "opts") {
      // - 唔係幾舒服…… / Not feeling well… → S4
      const m = raw.match(/^\s*-\s*(.+?)\s*\/\s*(.+?)\s*(?:→\s*(S\d+|END))?\s*$/);
      if (m) {
        cur.options.push({
          zh: m[1].trim(),
          en: m[2].trim(),
          go: m[3] === "END" ? null : (m[3] ?? null),
        });
        continue;
      }
      if (/^\s*[-*]\s/.test(raw)) continue; // an unparsed bullet — skip, do not corrupt
      mode = "prose";
    }

    // **AI:** zh  /  **AI → Daughter…:** zh
    const ai = raw.match(/^\*\*AI[^*]*:\*\*\s*(.*)$/);
    if (ai) {
      const zh = ai[1].trim();
      // The English sits on the next non-empty line, unmarked.
      let en = "";
      for (let j = i + 1; j < lines.length; j++) {
        const nx = lines[j].trim();
        if (!nx) continue;
        if (/^(\*\*|>|\*End|-\s|Elder options|Reply options|###|##|→)/.test(nx)) break;
        en = nx;
        i = j;
        break;
      }
      // An italic stage direction, e.g. *((The phone rings…))*, is not spoken.
      if (/^\*\*\(\(/.test(zh) || /^\(\(/.test(zh)) continue;
      cur.say.push({ zh, en });
      continue;
    }
  }
  return sections;
}

const S = parse();

/* --------------------------------------------------------------- validate */

const problems = [];
for (let n = 1; n <= 44; n++) {
  const id = `S${n}`;
  const sec = S.get(id);
  if (!sec) { problems.push(`missing section ${id}`); continue; }
  // A section with no spoken lines is legitimate only when it is a terminal
  // System-only section: S44 hands the case to a human operator and says
  // nothing. Such a section must still end, or the call would hang.
  if (!sec.say.length && !sec.options.length) {
    if (!sec.end) problems.push(`${id} has nothing to say and never ends`);
    else if (!sec.system.length) problems.push(`${id} has nothing to say and no System note explaining why`);
  }
  // Every target must exist, or the call dies mid-conversation.
  for (const o of sec.options) {
    if (o.go && !S.has(o.go)) problems.push(`${id} option "${o.zh}" points at missing ${o.go}`);
  }
  if (sec.next && !S.has(sec.next)) problems.push(`${id} next points at missing ${sec.next}`);
}
// A section must be able to move on: next, end, or at least one option.
for (const [id, sec] of S) {
  if (!sec.next && !sec.end && !sec.options.length) problems.push(`${id} is a dead end`);
}

if (problems.length) {
  console.error("Script problems found — refusing to generate:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

/* ------------------------------------------------------ section → metadata */

// The flags the runtime needs. Derived from what each section actually says and
// does, so they cannot be forgotten when the wording changes.
const DANGER = new Set(["S5", "S6", "S7", "S8", "S10"]);
const UNSAFE = new Set(["S23", "S24"]);
const ACTIVITY = new Set(["S17", "S18", "S20", "S21", "S29", "S31", "S35", "S37"]);
const ASK = { S3: "你今日覺得點呀？" };
const ESCALATE = new Set([
  "S5", "S6", "S7", "S8", "S9", "S10", "S11", "S12", "S13", "S14",
  "S23", "S24", "S33", "S42", "S43", "S44",
]);

const ORDER = [...S.keys()].sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10));

const SYSTEM_NOTE = {};
for (const id of ORDER) {
  const s = S.get(id);
  const dangerNote = s.system.find((x) => /Immediate danger|Fall and cannot|Unsafe statement|Worrying answer|Unclear answer|Still unclear|Request for help|no answer|Activity interest|Visit request/i.test(x));
  if (dangerNote) {
    SYSTEM_NOTE[id] = dangerNote
      .replace(/^System\s*\[[^\]]*\]\s*/, "")
      .replace(/\s*Rule:.*$/, (m) => m)
      .trim();
  }
}

/* ------------------------------------------------------------- render JS/TS */

const esc = (t) => t.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

function renderSections(indent) {
  const pad = " ".repeat(indent);
  const out = [];
  for (const id of ORDER) {
    const s = S.get(id);
    const flags = [];
    if (ASK[id]) flags.push(`ask: "${esc(ASK[id])}"`);
    if (DANGER.has(id)) flags.push("danger: true");
    if (UNSAFE.has(id)) flags.push("unsafe: true");
    if (ACTIVITY.has(id)) flags.push("activity: true");

    out.push(`${pad}${id}: {`);
    out.push(`${pad}  id: "${id}",`);
    if (s.title) out.push(`${pad}  title: "${esc(s.title)}",`);
    if (flags.length) out.push(`${pad}  ${flags.join(", ")} ,`);
    out.push(`${pad}  say: [`);
    for (const l of s.say) {
      out.push(`${pad}    s("${esc(l.zh)}",`);
      out.push(`${pad}      "${esc(l.en)}"),`);
    }
    out.push(`${pad}  ],`);
    if (s.options.length) {
      out.push(`${pad}  options: [`);
      for (const o of s.options) {
        out.push(`${pad}    o("${esc(o.zh)}", "${esc(o.en)}", ${o.go ? `"${o.go}"` : "null"}),`);
      }
      out.push(`${pad}  ],`);
    }
    if (s.next) out.push(`${pad}  next: "${s.next}",`);
    if (s.end) out.push(`${pad}  end: true,`);
    out.push(`${pad}},`);
  }
  return out.join("\n").replace(/ ,\n/g, ",\n");
}

/* --------------------------------------------------------- write the TS file */

const tsPath = join(root, "src", "lib", "script.ts");
let ts = readFileSync(tsPath, "utf8");

const tsBlock = `// BEGIN GENERATED CARE_SCRIPT — produced by scripts/gen-script-from-md.mjs
// Do not edit by hand: run the generator instead. Source: ElderLink_Call_Script.md
export const CARE_SCRIPT: Record<string, CareSection> = {
${renderSections(2)}
};

export const OPENING_FOR = { sensor: "S2", scheduled: "S1" } as const;

/** Sections whose outcome must be escalated to a human. */
export const ESCALATE = new Set([
${ORDER.filter((i) => ESCALATE.has(i)).map((i) => `  "${i}",`).join("\n")}
]);

/** The one-line note the dashboard records for a section, from the markdown. */
export const SYSTEM_NOTE: Record<string, string> = {
${Object.entries(SYSTEM_NOTE).map(([k, v]) => `  ${k}: "${esc(v)}",`).join("\n")}
};
// END GENERATED CARE_SCRIPT`;

const tsStart = ts.indexOf("// BEGIN GENERATED CARE_SCRIPT");
const tsEnd = ts.indexOf("// END GENERATED CARE_SCRIPT");
if (tsStart === -1 || tsEnd === -1) throw new Error("markers not found in src/lib/script.ts");
ts = ts.slice(0, tsStart) + tsBlock + ts.slice(tsEnd + "// END GENERATED CARE_SCRIPT".length);
writeFileSync(tsPath, ts, "utf8");

/* -------------------------------------------------------- write the plain JS */

const jsPath = join(root, "public", "call-script.js");
let js = readFileSync(jsPath, "utf8");

const jsBlock = `// BEGIN GENERATED SCRIPT — produced by scripts/gen-script-from-md.mjs
// Do not edit by hand: run the generator instead. Source: ElderLink_Call_Script.md
export const CALLER_NAME = "Elderly care team";

/** The elder and her people, from the script's sample cast. */
export const CAST = {
  elder: { zh: "陳婆婆", en: "Mrs Chan" },
  daughter: { zh: "家欣", en: "Ka Yan" },
  nephew: { zh: "偉文", en: "Wai Man" },
  socialWorker: { zh: "李姑娘", en: "Ms Lee" },
  operator: { zh: "黃生", en: "Mr Wong" },
  centre: { zh: "樂安長者中心", en: "Lok On Elderly Centre" },
};

const s = (zh, en) => ({ zh, en });
const o = (zh, en, go) => ({ zh, en, go });

export const SCRIPT = {
${renderSections(2)}
};

export const OPENING_FOR = { sensor: "S2", scheduled: "S1" };

/** Sections whose outcome must be escalated to a human. */
export const ESCALATE = new Set([
${ORDER.filter((i) => ESCALATE.has(i)).map((i) => `  "${i}",`).join("\n")}
]);

/** The one-line note the dashboard records for a section, from the markdown. */
export const SYSTEM_NOTE = {
${Object.entries(SYSTEM_NOTE).map(([k, v]) => `  ${k}: "${esc(v)}",`).join("\n")}
};
// END GENERATED SCRIPT`;

const jsStart = js.indexOf("// BEGIN GENERATED SCRIPT");
const jsEnd = js.indexOf("// END GENERATED SCRIPT");
if (jsStart === -1 || jsEnd === -1) throw new Error("markers not found in public/call-script.js");
js = js.slice(0, jsStart) + jsBlock + js.slice(jsEnd + "// END GENERATED SCRIPT".length);
writeFileSync(jsPath, js, "utf8");

/* ------------------------------------------------------------------ report */

const totalLines = ORDER.reduce((n, id) => n + S.get(id).say.length, 0);
const totalOpts = ORDER.reduce((n, id) => n + S.get(id).options.length, 0);
console.log(`Parsed ${ORDER.length} sections from ${SRC}`);
console.log(`  ${totalLines} spoken lines, ${totalOpts} options`);
console.log(`  ${ESCALATE.size} sections escalate`);
console.log(`Wrote src/lib/script.ts and public/call-script.js`);
