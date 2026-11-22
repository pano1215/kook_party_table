// AI 대리 호출: 키는 서버 환경변수(GROQ_API_KEY)에만 둔다
const L = require("./_lib");
module.exports = async (req, res) => {
  try {
    const key = process.env.GROQ_API_KEY;
    if (!key) return L.send(res, 503, { error: "서버에 AI 키가 없어요." });
    if (!(await L.limit(req, "ai", 40))) return L.send(res, 429, { error: "AI 요청이 많아요. 잠시 뒤 다시 시도해 주세요." });
    const b = await L.body(req);
    const s = JSON.stringify(b.content || "");
    if (s.length > 6000000) return L.send(res, 413, { error: "요청이 너무 커요." });
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: process.env.GROQ_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct", messages: [{ role: "user", content: b.content }], response_format: { type: "json_object" }, temperature: 0.4, max_completion_tokens: 4096 }),
    });
    if (r.status === 429) return L.send(res, 429, { error: "AI 요청 한도를 넘었어요. 잠시 뒤 다시 시도해 주세요." });
    if (!r.ok) return L.send(res, 502, { error: `AI 요청이 실패했어요(${r.status}).` });
    const raw = ((await r.json()).choices?.[0]?.message?.content || "").trim();
    L.send(res, 200, { raw });
  } catch (e) { L.send(res, 500, { error: "AI 호출 중 문제가 생겼어요." }); }
};
