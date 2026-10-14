// POST /api/demo/mock-verify — 模擬電話驗證 API（示範用）
//
// 呢個係一個「假」嘅電話驗證服務：唔會打真電話、唔會發真短訊、
// 亦都唔會連接任何第三方驗證供應商（Twilio Verify、Firebase 等一律唔用）。
// 佢完全喺伺服器內部用固定假資料運作，所以喺 Vercel 上面可以安全部署。
//
// 支援兩種動作（action）：
//   "start"  → 輸入電話號碼，假裝發送驗證碼
//   "verify" → 輸入驗證碼，核對後回傳成功或失敗
//
// 安全設計：
//   - 唔會讀寫任何真實資料庫，狀態只存在記憶體（serverless 冷啟動會清空）。
//   - 唔會記錄或回傳完整電話號碼，只回傳尾四位嘅遮罩版本。
//   - 固定驗證碼只喺示範模式先會回傳，方便評審即場試玩。

import { createFileRoute } from "@tanstack/react-router";

// ---------------------------------------------------------------------------
// 假資料設定（environment-safe mock data）
// ---------------------------------------------------------------------------

/** 示範用固定驗證碼。真實驗證服務絕對唔會咁做，呢個純粹為咗示範。 */
const MOCK_CODE = "123456";

/** 驗證碼有效期：5 分鐘。 */
const CODE_TTL_MS = 5 * 60 * 1000;

/** 每個電話號碼最多試 5 次，防止無限重試。 */
const MAX_ATTEMPTS = 5;

/** 香港電話號碼格式：+852 之後 8 位數字（可以帶空格或短橫）。 */
const HK_PHONE_RE = /^\+?852[\s-]?(\d{4})[\s-]?(\d{4})$/;

/**
 * 記憶體工作階段。Serverless 函式每個 instance 有自己嘅記憶體，
 * 所以呢個只係示範用途，唔適合正式環境。
 */
type Session = {
  phoneTail: string;
  code: string;
  issuedAt: number;
  attempts: number;
  verified: boolean;
};

const sessions = new Map<string, Session>();

/** 由電話號碼產生一個穩定嘅工作階段 key（唔會外洩完整號碼）。 */
function sessionKey(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  // 只用後六位做 key，避免完整號碼留喺記憶體 key 入面。
  return `hk:${digits.slice(-6)}`;
}

/** 將電話號碼遮罩成 +852 •••• 1234 嘅樣。 */
function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `+852 •••• ${digits.slice(-4)}`;
}

/** 檢查電話格式，回傳標準化號碼或錯誤訊息。 */
function normalisePhone(raw: unknown): { ok: true; phone: string } | { ok: false; error: string } {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, error: "請輸入電話號碼。" };
  }
  const cleaned = raw.replace(/[\s()-]/g, "");
  const withPlus = cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
  if (!HK_PHONE_RE.test(withPlus)) {
    return { ok: false, error: "電話號碼格式唔正確，請輸入香港號碼（例：+852 9123 4567）。" };
  }
  const digits = withPlus.replace(/\D/g, "");
  return { ok: true, phone: `+${digits}` };
}

/** 開始驗證：產生（假裝發送）一個驗證碼。 */
function startVerification(rawPhone: unknown) {
  const parsed = normalisePhone(rawPhone);
  if (!parsed.ok) {
    return { status: 400, body: { ok: false, error: parsed.error } };
  }

  const key = sessionKey(parsed.phone);
  const session: Session = {
    phoneTail: parsed.phone.slice(-4),
    code: MOCK_CODE,
    issuedAt: Date.now(),
    attempts: 0,
    verified: false,
  };
  sessions.set(key, session);

  // 示範重點：明確講明呢個係模擬，唔會發真短訊。
  return {
    status: 200,
    body: {
      ok: true,
      mock: true,
      masked_phone: maskPhone(parsed.phone),
      channel: "sms",
      expires_in_seconds: CODE_TTL_MS / 1000,
      message: "模擬驗證碼已「發送」。示範環境唔會發出真短訊。",
      // 只有示範模式先會回傳驗證碼，方便即場測試。
      demo_code: MOCK_CODE,
      demo_notice: "示範用驗證碼：123456（正式環境絕對唔會顯示）。",
    },
  };
}

/** 核對驗證碼。 */
function verifyCode(rawPhone: unknown, rawCode: unknown) {
  const parsed = normalisePhone(rawPhone);
  if (!parsed.ok) {
    return { status: 400, body: { ok: false, error: parsed.error } };
  }

  if (typeof rawCode !== "string" || !/^\d{6}$/.test(rawCode.trim())) {
    return { status: 400, body: { ok: false, error: "請輸入 6 位數字驗證碼。" } };
  }

  const key = sessionKey(parsed.phone);
  const session = sessions.get(key);
  if (!session) {
    return {
      status: 404,
      body: { ok: false, error: "搵唔到驗證記錄，請先按「發送驗證碼」。" },
    };
  }

  if (session.verified) {
    return {
      status: 200,
      body: { ok: true, verified: true, message: "呢個號碼已經驗證過。" },
    };
  }

  if (Date.now() - session.issuedAt > CODE_TTL_MS) {
    sessions.delete(key);
    return {
      status: 410,
      body: { ok: false, error: "驗證碼已過期，請重新發送。" },
    };
  }

  if (session.attempts >= MAX_ATTEMPTS) {
    sessions.delete(key);
    return {
      status: 429,
      body: { ok: false, error: "嘗試次數過多，請重新發送驗證碼。" },
    };
  }

  session.attempts += 1;

  if (rawCode.trim() !== session.code) {
    const left = MAX_ATTEMPTS - session.attempts;
    return {
      status: 400,
      body: {
        ok: false,
        error: `驗證碼唔正確。仲有 ${left} 次機會。`,
        attempts_left: left,
      },
    };
  }

  session.verified = true;
  return {
    status: 200,
    body: {
      ok: true,
      verified: true,
      masked_phone: maskPhone(parsed.phone),
      message: "電話號碼驗證成功！",
      mock: true,
    },
  };
}

export const Route = createFileRoute("/api/demo/mock-verify")({
  server: {
    handlers: {
      // 只接受 POST，避免驗證碼經 URL 或者瀏覽器記錄外洩。
      POST: async ({ request }) => {
        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return Response.json({ ok: false, error: "請求格式唔正確。" }, { status: 400 });
        }

        const body = (payload ?? {}) as Record<string, unknown>;
        const action = body["action"];

        const result =
          action === "start"
            ? startVerification(body["phone"])
            : action === "verify"
              ? verifyCode(body["phone"], body["code"])
              : {
                  status: 400,
                  body: { ok: false, error: "不支援嘅動作，請用 start 或 verify。" },
                };

        return Response.json(result.body, { status: result.status });
      },

      // 方便用瀏覽器快速檢查路由有冇正常運作。
      GET: async () =>
        Response.json({
          ok: true,
          endpoint: "/api/demo/mock-verify",
          description: "模擬電話驗證 API（示範用，唔會發出真短訊或真電話）。",
          usage: {
            start: 'POST { "action": "start", "phone": "+852 9123 4567" }',
            verify: 'POST { "action": "verify", "phone": "+852 9123 4567", "code": "123456" }',
          },
          demo_code: MOCK_CODE,
        }),
    },
  },
});
