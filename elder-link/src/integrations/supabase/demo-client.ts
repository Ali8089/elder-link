/**
 * A minimal, Supabase-compatible client backed by the in-memory demo database.
 *
 * It implements only the subset the Elder Link UI actually uses: the
 * query-builder calls (`select` / `insert` / `update` with filters, ordering,
 * limits and embedded relations), plus the auth and realtime stubs the layout
 * needs. The builder is thenable, so
 *
 *     await supabase.from("cases").select("*, elders(display_name)")
 *
 * behaves exactly like the real client.
 */
import { createDemoDb, uuid, DEMO_SESSION, type DemoDb, type Row } from "./demo-db";

type Filter = { op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in"; col: string; val: unknown };
type Rel = { table: string; kind: "one" | "many"; key: string };
type Embed = { name: string; table: string; columns: string[] | "*"; inner: boolean };

/** Foreign keys the UI embeds through (mirrors the Postgres relationships). */
const RELATIONS: Record<string, Record<string, Rel>> = {
  cases: {
    elders: { table: "elders", kind: "one", key: "elder_id" },
    escalation_steps: { table: "escalation_steps", kind: "many", key: "case_id" },
  },
  call_jobs: { elders: { table: "elders", kind: "one", key: "elder_id" } },
  escalation_steps: { cases: { table: "cases", kind: "one", key: "case_id" } },
};

/** Unique constraints the code relies on (idempotent webhooks, seed rows).
 *  Each entry is a list of column-sets; a set of two columns is a composite key. */
const UNIQUE: Record<string, string[][]> = {
  telephony_events: [["event_id"]],
  sensor_alerts: [["external_id"]],
  activities: [["code"]],
  login_attempts: [["email", "ip"]],
};

const DAY = 24 * 3_600_000;

/** Column defaults, mirroring the SQL migrations. */
const DEFAULTS: Record<string, () => Row> = {
  elders: () => ({
    reference_number: "", district: "", centre: "", phone: "", preferred_language: "yue",
    preferred_call_time: "", consent_elder: false, consent_contact: false, consent_service: false,
    consent_checked_at: null, status: "draft", check_interval_days: 2, next_check_at: null,
    last_check_at: null, opted_out_at: null, created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }),
  contacts: () => ({ relation: "", priority: 1 }),
  call_jobs: () => ({
    kind: "scheduled", attempt: 1, status: "queued", outcome: null, activity_suggestion: null,
    due_at: new Date().toISOString(), started_at: null, completed_at: null,
    created_at: new Date().toISOString(),
  }),
  cases: () => ({
    call_job_id: null, severity: 2, status: "open", note: null, version: 1,
    trigger_at: new Date().toISOString(), escalation_started_at: null, acknowledged_at: null,
    acknowledged_by: null, closed_at: null, created_at: new Date().toISOString(),
  }),
  escalation_steps: () => ({ target_label: "", status: "pending", started_at: null, ended_at: null }),
  sensor_alerts: () => ({
    alert_type: "inactivity", call_job_id: null, status: "open", safe_note: null,
    human_informed_at: null, received_at: new Date().toISOString(), closed_at: null,
  }),
  telephony_events: () => ({ call_job_id: null, received_at: new Date().toISOString() }),
  audit_events: () => ({ actor: null, entity_id: null, at: new Date().toISOString() }),
  activities: () => ({ active: true }),
  activity_interests: () => ({ call_job_id: null, source: "staff", created_at: new Date().toISOString() }),
  notifications: () => ({
    case_id: null, channel: "phone", status: "pending", detail: null,
    created_at: new Date().toISOString(), sent_at: null,
  }),
  login_attempts: () => ({ ip: "", fails: 0, locked_until: null, updated_at: new Date().toISOString() }),
  scheduler_runs: () => ({
    finished_at: null, jobs_created: 0, jobs_run: 0, chains_advanced: 0, purged: 0,
    ok: true, detail: null,
  }),
  analytics_events: () => ({ ref: null, value: 1, at: new Date().toISOString() }),
};

const defaultsFor = (table: string): Row => (DEFAULTS[table] ? DEFAULTS[table]!() : {});

/** Splits on commas that are not inside parentheses. */
function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of input) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.filter(Boolean);
}

/** Parses `"*, elders(display_name), cases!inner(status)"`. */
function parseSelect(cols: string): { columns: string[] | "*"; embeds: Embed[] } {
  const embeds: Embed[] = [];
  const columns: string[] = [];
  let star = false;
  for (const part of splitTopLevel(cols || "*")) {
    const open = part.indexOf("(");
    if (open === -1) {
      if (part === "*") star = true;
      else columns.push(part);
      continue;
    }
    const head = part.slice(0, open);
    const inner = part.slice(open + 1, part.lastIndexOf(")"));
    const [rawName, ...hints] = head.split("!");
    const name = rawName!.trim();
    embeds.push({
      name,
      table: name,
      columns: inner.trim() === "" || inner.trim() === "*" ? "*" : splitTopLevel(inner),
      inner: hints.includes("inner"),
    });
  }
  return { columns: star ? "*" : columns, embeds };
}

function matches(row: Row, f: Filter): boolean {
  const v = row[f.col];
  switch (f.op) {
    case "eq": return v === f.val;
    case "neq": return v !== f.val;
    case "gt": return v > (f.val as never);
    case "gte": return v >= (f.val as never);
    case "lt": return v < (f.val as never);
    case "lte": return v <= (f.val as never);
    case "in": return Array.isArray(f.val) && f.val.includes(v);
    default: return true;
  }
}

/** Orders numbers numerically, ISO dates and strings lexically; nulls last. */
function cmp(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const as = String(a);
  const bs = String(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}

function project(row: Row, columns: string[] | "*", embeds: Embed[]): Row {
  if (columns === "*") return { ...row };
  const out: Row = {};
  for (const c of columns) out[c] = row[c];
  // Embedded relations are returned even when the base columns are explicit.
  for (const e of embeds) out[e.name] = row[e.name];
  return out;
}

class DemoQuery implements PromiseLike<{ data: any; error: any }> {
  private op: "select" | "insert" | "update" = "select";
  private filters: Filter[] = [];
  private orders: Array<{ col: string; asc: boolean }> = [];
  private limitN: number | null = null;
  private cols = "*";
  private payload: any = null;
  private singleMode: "none" | "single" | "maybe" = "none";
  private wantSelect = false;

  constructor(private db: DemoDb, private table: string) {}

  select(cols = "*") {
    this.cols = cols;
    this.wantSelect = true;
    return this;
  }

  insert(rows: Row | Row[]) {
    this.op = "insert";
    this.payload = rows;
    return this;
  }

  update(patch: Row) {
    this.op = "update";
    this.payload = patch;
    return this;
  }

  eq(col: string, val: unknown) { return this.add("eq", col, val); }
  neq(col: string, val: unknown) { return this.add("neq", col, val); }
  gt(col: string, val: unknown) { return this.add("gt", col, val); }
  gte(col: string, val: unknown) { return this.add("gte", col, val); }
  lt(col: string, val: unknown) { return this.add("lt", col, val); }
  lte(col: string, val: unknown) { return this.add("lte", col, val); }
  in(col: string, val: unknown[]) { return this.add("in", col, val); }

  order(col: string, opts?: { ascending?: boolean }) {
    this.orders.push({ col, asc: opts?.ascending !== false });
    return this;
  }

  limit(n: number) {
    this.limitN = n;
    return this;
  }

  single() {
    this.singleMode = "single";
    return this;
  }

  maybeSingle() {
    this.singleMode = "maybe";
    return this;
  }

  private add(op: Filter["op"], col: string, val: unknown) {
    this.filters.push({ op, col, val });
    return this;
  }

  then<R1 = { data: any; error: any }, R2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: any) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run().then(onfulfilled, onrejected);
  }

  private async run() {
    if (this.op === "insert") return this.runInsert();
    if (this.op === "update") return this.runUpdate();
    return this.runSelect();
  }

  private rows(): Row[] {
    return this.db[this.table] ?? [];
  }

  /** Resolves embedded relations; inner joins drop rows that do not match. */
  private resolveEmbeds(rows: Row[], embeds: Embed[]): Row[] {
    if (embeds.length === 0) return rows;
    const out: Row[] = [];
    for (const row of rows) {
      const next = { ...row };
      let keep = true;
      for (const e of embeds) {
        const rel = RELATIONS[this.table]?.[e.name];
        if (!rel) {
          next[e.name] = null;
          continue;
        }
        // Filters written as "relation.column" constrain the embedded table.
        const embedFilters = this.filters
          .filter((f) => f.col.startsWith(`${e.name}.`))
          .map((f) => ({ ...f, col: f.col.slice(e.name.length + 1) }));
        const candidates = (this.db[rel.table] ?? []).filter((c) =>
          embedFilters.every((f) => matches(c, f)),
        );
        if (rel.kind === "one") {
          const found = candidates.find((c) => c.id === row[rel.key]) ?? null;
          if (!found && (e.inner || embedFilters.length > 0)) keep = false;
          next[e.name] = found ? project(found, e.columns, []) : null;
        } else {
          const found = candidates.filter((c) => c[rel.key] === row.id);
          if (found.length === 0 && (e.inner || embedFilters.length > 0)) keep = false;
          next[e.name] = found.map((c) => project(c, e.columns, []));
        }
      }
      if (keep) out.push(next);
    }
    return out;
  }

  private async runSelect() {
    const { columns, embeds } = parseSelect(this.cols);
    const base = this.filters.filter((f) => !f.col.includes("."));
    let rows = this.rows().map((r) => ({ ...r }));
    for (const f of base) rows = rows.filter((r) => matches(r, f));
    rows = this.resolveEmbeds(rows, embeds);
    if (this.orders.length) {
      rows.sort((a, b) => {
        for (const o of this.orders) {
          const r = cmp(a[o.col], b[o.col]);
          if (r !== 0) return o.asc ? r : -r;
        }
        return 0;
      });
    }
    if (this.limitN != null) rows = rows.slice(0, this.limitN);
    return this.finish(rows.map((r) => project(r, columns, embeds)));
  }

  private async runInsert() {
    const input: Row[] = Array.isArray(this.payload) ? this.payload : [this.payload];
    const inserted: Row[] = [];
    for (const raw of input) {
      const row: Row = { id: uuid(), ...defaultsFor(this.table), ...raw };
      for (const cols of UNIQUE[this.table] ?? []) {
        const clash = this.rows().some((r) => cols.every((c) => r[c] === row[c]));
        if (clash) {
          return {
            data: null,
            error: { code: "23505", message: `duplicate key value violates unique constraint on ${this.table}(${cols.join(",")})` },
          };
        }
      }
      this.rows().push(row);
      inserted.push(row);
    }
    if (!this.wantSelect) return { data: null, error: null };
    const { columns, embeds } = parseSelect(this.cols);
    const rows = this.resolveEmbeds(inserted.map((r) => ({ ...r })), embeds);
    return this.finish(rows.map((r) => project(r, columns, embeds)));
  }

  private async runUpdate() {
    const base = this.filters.filter((f) => !f.col.includes("."));
    const updated: Row[] = [];
    for (const row of this.rows()) {
      if (base.every((f) => matches(row, f))) {
        Object.assign(row, this.payload);
        updated.push({ ...row });
      }
    }
    if (!this.wantSelect) return { data: null, error: null };
    const { columns, embeds } = parseSelect(this.cols);
    const rows = this.resolveEmbeds(updated, embeds);
    return this.finish(rows.map((r) => project(r, columns, embeds)));
  }

  private finish(data: Row[]) {
    if (this.singleMode === "single") {
      if (data.length === 0) {
        return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned" } };
      }
      return { data: data[0], error: null };
    }
    if (this.singleMode === "maybe") return { data: data[0] ?? null, error: null };
    return { data, error: null };
  }
}

/**
 * True when the app should run against the in-memory demo database instead of
 * a real Supabase project:
 *   - `VITE_DEMO_MODE=1`, or
 *   - no Supabase credentials in a development build.
 * A production build never falls back silently — it keeps throwing, so fake
 * data can never reach a deployed environment by accident.
 */
export function isDemoMode(): boolean {
  const env = import.meta.env as Record<string, any>;
  const proc = typeof process !== "undefined" ? process.env : {};
  const flag = env["VITE_DEMO_MODE"] ?? proc["VITE_DEMO_MODE"];
  if (flag === "1") return true;
  const url = env["VITE_SUPABASE_URL"] || proc["SUPABASE_URL"];
  const key = env["VITE_SUPABASE_PUBLISHABLE_KEY"] || proc["SUPABASE_PUBLISHABLE_KEY"];
  if (env["PROD"]) return false;
  return !url || !key;
}

export function createDemoClient() {
  const db = createDemoDb();
  console.info(
    "%c[Elder Link] Demo mode — in-memory data + mock telephony. Reload resets. Set VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY to use a real project.",
    "color:#0a7",
  );

  return {
    from: (table: string) => new DemoQuery(db, table),

    auth: {
      getSession: async () => ({ data: { session: DEMO_SESSION }, error: null }),
      getUser: async () => ({ data: { user: DEMO_SESSION.user }, error: null }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        // Mirrors the real client's INITIAL_SESSION emission, off the render path.
        queueMicrotask(() => cb("SIGNED_IN", DEMO_SESSION));
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      setSession: async () => ({ data: { session: DEMO_SESSION }, error: null }),
      signInWithPassword: async () => ({ data: { session: DEMO_SESSION, user: DEMO_SESSION.user }, error: null }),
      // Always signed in during a demo, so nobody can lock themselves out.
      signOut: async () => {
        console.info("[Elder Link] Demo mode keeps you signed in as", DEMO_SESSION.user.email);
        return { error: null };
      },
    },

    // Realtime is a no-op: every query refetches on demand anyway.
    channel: (_name: string) => {
      const ch = {
        on: () => ch,
        subscribe: () => ch,
        unsubscribe: () => ch,
      };
      return ch;
    },
    removeChannel: () => {},

    rpc: async (name: string) => {
      if (name === "purge_opted_out_elders") {
        const cutoff = Date.now() - 30 * DAY;
        const before = db.elders.length;
        db.elders = db.elders.filter(
          (e) => !(e.status === "opted_out" && e.opted_out_at && new Date(e.opted_out_at).getTime() < cutoff),
        );
        const purged = before - db.elders.length;
        if (purged > 0) {
          db.audit_events.push({
            id: uuid(), actor: null, action: `purge:${purged}`, entity: "elders",
            entity_id: null, at: new Date().toISOString(),
          });
        }
        return { data: purged, error: null };
      }
      return { data: null, error: { message: `rpc ${name} is not available in demo mode` } };
    },
  };
}
