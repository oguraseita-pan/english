// api/tts.js — Groq TTS 中継（Vercel Serverless Function）
// 環境変数: GROQ_API_KEY（必須）, GROQ_TTS_MODEL（任意・既定 canopylabs/orpheus-v1-english）
// リクエスト:  POST { input:string, voice?:string, speed?:number }
// レスポンス: { audio: <base64 wav> } または { error }
const TTS_MODEL = process.env.GROQ_TTS_MODEL || 'canopylabs/orpheus-v1-english';
const VOICES = ['autumn', 'diana', 'hannah', 'austin', 'daniel', 'troy'];

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }
  if (!process.env.GROQ_API_KEY) { res.status(500).json({ error: 'GROQ_API_KEY not set' }); return; }
  try {
    const { input, voice, speed } = req.body || {};
    const text = String(input || '').slice(0, 1200).trim();
    if (!text) { res.status(400).json({ error: 'input required' }); return; }
    const v = VOICES.includes(voice) ? voice : 'daniel';
    const sp = Math.min(2, Math.max(0.5, Number(speed) || 1));
    const r = await fetch('https://api.groq.com/openai/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.GROQ_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model: TTS_MODEL, input: text, voice: v, speed: sp, response_format: 'wav' })
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      res.status(502).json({ error: (data && data.error && data.error.message) || ('groq_tts_http_' + r.status) });
      return;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.status(200).json({ audio: buf.toString('base64') });
  } catch (e) {
    res.status(502).json({ error: String((e && e.message) || e) });
  }
};
