// 운영자: 핵심 행동 기록과 인터뷰 신청(연락처·동의 기록) (OPS_KEY 필요)
const L = require("./_lib");
module.exports = async (req, res) => {
  try {
    const key = process.env.OPS_KEY || "";
    if (await L.blocked(req, "opsfail", 10)) return L.send(res, 429, { error: "여러 번 틀렸어요. 한 시간 뒤 다시 시도해 주세요." });
    if (!key || !L.safeEq(req.headers["x-ops-key"] || "", key)) { await L.bump(req, "opsfail"); return L.send(res, 401, { error: "운영자 키가 맞지 않아요." }); }
    const events = ((await L.cmd("LRANGE", "events", "0", "-1")) || []).map((x) => JSON.parse(x));
    const ids = (await L.cmd("LRANGE", "leadids", "0", "-1")) || [];
    const leads = [];
    for (const id of ids) {                 // 90일이 지나 지워졌거나 취소된 신청은 건너뛴다
      const v = await L.cmd("GET", `lead:${id}`);
      if (v) { const { token_hash, ...r } = JSON.parse(v); leads.push(r); }
    }
    L.send(res, 200, { events, leads });
  } catch (e) { console.error("[moggu]", req.method, req.url, e && e.message); L.send(res, 500, { error: "서버에서 문제가 생겼어요." }); }
};
