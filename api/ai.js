// AI 대리 호출: 키는 서버 환경변수(GROQ_API_KEY)에만 둔다. 사용자는 키를 넣지 않는다
// Groq가 모델을 자주 정리하므로(예: llama-4-scout 2026-07-17 종료) 여러 모델을 차례로 시도한다. GROQ_MODEL로 맨 앞 모델을 바꿀 수 있다
const L = require("./_lib");
const MODELS = [process.env.GROQ_MODEL, "openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b"].filter(Boolean);
// 모델 응답에서 JSON 객체만 꺼낸다(코드블록·앞뒤 설명이 붙어 와도 읽히게)
function pickJson(text) {
  const t = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try { JSON.parse(t); return t; } catch {}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { const cut = t.slice(a, b + 1); try { JSON.parse(cut); return cut; } catch {} }
  return t;
}
module.exports = async (req, res) => {
  try {
    const key = process.env.GROQ_API_KEY;
    if (!key) return L.send(res, 503, { error: "서버에 AI 키가 없어요." });
    if (!(await L.limit(req, "ai", 40))) return L.send(res, 429, { error: "AI 요청이 많아요. 잠시 뒤 다시 시도해 주세요." });
    const b = await L.body(req);
    const s = JSON.stringify(b.content || "");
    if (s.length > 6000000) return L.send(res, 413, { error: "요청이 너무 커요." });
    let last = 0;
    for (const model of [...new Set(MODELS)]) {
      for (const extra of [{ response_format: { type: "json_object" } }, {}]) {   // JSON 모드를 못 쓰는 모델이면 그냥 다시 부른다
        const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({ model, messages: [{ role: "user", content: b.content }], temperature: 0.4, max_completion_tokens: 6000, ...extra }),
        });
        last = r.status;
        if (r.status === 429) return L.send(res, 429, { error: "AI 요청 한도를 넘었어요. 잠시 뒤 다시 시도해 주세요." });
        if (r.status === 401 || r.status === 403) return L.send(res, 502, { error: "AI 키가 맞지 않아요. 서버의 GROQ_API_KEY를 확인해 주세요." });
        if (!r.ok) continue;   // 종료된 모델(404)·지원하지 않는 옵션(400)이면 다음 조합으로
        const raw = ((await r.json()).choices?.[0]?.message?.content || "").trim();
        if (raw) return L.send(res, 200, { raw: pickJson(raw), model });
      }
    }
    L.send(res, 502, { error: `AI 요청이 실패했어요(${last}). 쓸 수 있는 모델이 없으면 GROQ_MODEL 환경변수로 모델을 지정해 주세요.` });
  } catch (e) { L.send(res, 500, { error: "AI 호출 중 문제가 생겼어요." }); }
};
