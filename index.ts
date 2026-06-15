// Supabase Edge Function: "ai"
// SproutのAIリクエストを中継します。Gemini APIキーはこのサーバー（Supabaseのsecret）に
// 隠され、クライアントには絶対に出ません。ログイン済みユーザーのみ利用できます。
//
// ▼ デプロイ手順（ダッシュボードでもCLIでも可。詳細は会話を参照）
//   1) Project Settings → Edge Functions → Secrets に GEMINI_API_KEY を登録
//      （必要なら GEMINI_MODEL も。未設定なら gemini-2.5-flash-lite を使用）
//   2) この index.ts でфунк ai を作成し、"Verify JWT" は OFF（このコードが自前で検証します）
//
// 注：SUPABASE_URL / SUPABASE_ANON_KEY はSupabaseがEdge Functionに自動で渡します。

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY");
  // 「一番無料枠が多いモデル」= Flash-Lite。secretで上書き可能。
  const MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash-lite";

  if (!GEMINI_KEY) return json({ error: "server_not_configured" }, 500);

  // --- ログイン確認：有効なユーザーのみ（キーの不正利用を防ぐ） ---
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "auth_required" }, 401);
  let user: { id: string } | null = null;
  try {
    const ures = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${jwt}`, apikey: ANON },
    });
    if (!ures.ok) return json({ error: "auth_invalid" }, 401);
    user = await ures.json();
  } catch {
    return json({ error: "auth_check_failed" }, 401);
  }
  if (!user || !user.id) return json({ error: "auth_invalid" }, 401);

  // === 将来ここでプラン判定 ===
  // 例) user.id を使って利用回数の上限チェック／有料判定を行い、
  //     有料なら上位モデル、無料なら Flash-Lite、上限超過なら 429 を返す。
  // いまは全員 Flash-Lite（無料枠が最大のモデル）。

  // --- リクエスト本文 ---
  let payload: { messages?: { role: string; content: string }[]; json?: boolean; temp?: number };
  try { payload = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  if (!messages.length) return json({ error: "no_messages" }, 400);

  // --- メッセージを Gemini 形式へ ---
  const sys = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: typeof payload.temp === "number" ? payload.temp : 0.7,
      ...(payload.json ? { responseMimeType: "application/json" } : {}),
    },
  };
  if (sys) body.systemInstruction = { parts: [{ text: sys }] };

  // --- Gemini 呼び出し（キーはサーバー内のみ） ---
  let gres: Response;
  try {
    gres = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    );
  } catch {
    return json({ error: "upstream_unreachable" }, 502);
  }

  if (gres.status === 429) return json({ error: "rate_limited_429" }, 429);
  if (!gres.ok) {
    const t = await gres.text().catch(() => "");
    return json({ error: `upstream_${gres.status}`, detail: t.slice(0, 300) }, gres.status >= 500 ? 502 : 400);
  }

  const data = await gres.json();
  const parts = data?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts) ? parts.map((p: { text?: string }) => p.text || "").join("") : "";
  if (!text) return json({ error: "empty" }, 502);

  return json({ text });
});
