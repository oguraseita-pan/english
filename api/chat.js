// api/chat.js — Groq チャット中継（Vercel Serverless Function）
// 環境変数: GROQ_API_KEY（必須）, GROQ_CHAT_MODEL（任意・既定 openai/gpt-oss-120b）
// リクエスト:  POST { messages:[{role,content}...], json?:bool, temp?:number }
//   ※ messages の先頭が role:'system' でも可（そのままGroqに渡す）
// レスポンス: { text } または { error }
const PRIMARY = process.env.GROQ_CHAT_MODEL || 'openai/gpt-oss-120b';
const FALLBACK = process.env.GROQ_CHAT_MODEL_FALLBACK || 'openai/gpt-oss-20b';

async function groqChat(model, messages, json, temp) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.GROQ_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: (temp != null) ? temp : 0.7,
      max_completion_tokens: 1024,
      ...(json ? { response_format: { type: 'json_object' } } : {})
    })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (data && data.error && data.error.message) || ('groq_http_' + r.status);
    const e = new Error(msg); e.status = r.status; throw e;
  }
  return ((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '').trim();
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }
  if (!process.env.GROQ_API_KEY) { res.status(500).json({ error: 'GROQ_API_KEY not set' }); return; }
  try {
    const { messages, json, temp } = req.body || {};
    if (!Array.isArray(messages) || !messages.length) { res.status(400).json({ error: 'messages required' }); return; }
    let text;
    try {
      text = await groqChat(PRIMARY, messages, !!json, temp);
    } catch (e) {
      // モデル起因（廃止・未提供・レート）の場合はフォールバックモデルで再試行
      if (/model|decommission|not ?found|404|400|429|quota/i.test(String(e.message)) && FALLBACK !== PRIMARY) {
        text = await groqChat(FALLBACK, messages, !!json, temp);
      } else { throw e; }
    }
    if (!text) { res.status(502).json({ error: 'empty_response' }); return; }
    res.status(200).json({ text });
  } catch (e) {
    res.status(502).json({ error: String((e && e.message) || e) });
  }
};
