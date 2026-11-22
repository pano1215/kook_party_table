// 저장소 점검: 배포주소/api/health 를 열면 저장소에 쓰고 읽을 수 있는지 보여 준다
// 막힌 단계와 오류 문구는 운영자 키가 맞을 때만 보여 준다(배포주소/api/health?key=운영자키). OPS_KEY 를 아직 정하지 않았으면 처음 설정을 돕기 위해 그대로 보여 준다
const L = require("./_lib");
module.exports = async (req, res) => {
  try {
    if (!(await L.limit(req, "health", 30).catch(() => true))) return L.send(res, 429, { error: "잠시 뒤 다시 시도해 주세요." });
    const c = await L.storageCheck();
    const ops = process.env.OPS_KEY || "", given = new URL(req.url, "http://x").searchParams.get("key") || req.headers["x-ops-key"] || "";
    const detail = !ops || L.safeEq(given, ops);
    const out = detail ? c : { kind: c.kind, ok: c.ok, hint: c.ok ? undefined : "자세한 오류는 주소 뒤에 ?key=운영자키 를 붙여 열면 보여요." };
    L.send(res, c.ok ? 200 : 500, { ...out, ai: !!process.env.GROQ_API_KEY, ops_key: !!ops });
  } catch (e) { console.error("[moggu]", req.method, req.url, e && e.message); L.send(res, 500, { ok: false }); }
};
