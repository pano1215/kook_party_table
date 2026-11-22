// 저장소 점검: 배포주소/api/health 를 열면 저장소에 쓰고 읽을 수 있는지와, 막힌 단계의 오류를 보여 준다(키 값은 보여 주지 않는다)
const L = require("./_lib");
module.exports = async (req, res) => {
  try {
    if (!(await L.limit(req, "health", 30).catch(() => true))) return L.send(res, 429, { error: "잠시 뒤 다시 시도해 주세요." });
    const c = await L.storageCheck();
    L.send(res, c.ok ? 200 : 500, { ...c, ai: !!process.env.GROQ_API_KEY, ops_key: !!process.env.OPS_KEY });
  } catch (e) { console.error("[moggu]", req.method, req.url, e && e.message); L.send(res, 500, { ok: false, error: String(e.message || e).slice(0, 300) }); }
};
