// 운영자: 핵심 행동 기록과 인터뷰 신청(연락처·동의 기록) (OPS_KEY 필요)
const L = require("./_lib");
module.exports = async (req, res) => {
  const key = process.env.OPS_KEY || "";
  if (!key || (req.headers["x-ops-key"] || "") !== key) return L.send(res, 401, { error: "운영자 키가 맞지 않아요." });
  const events = ((await L.cmd("LRANGE", "events", "0", "-1")) || []).map((x) => JSON.parse(x));
  const ids = (await L.cmd("LRANGE", "leadids", "0", "-1")) || [];
  const leads = [];
  for (const id of ids) {                 // 90일이 지나 지워졌거나 취소된 신청은 건너뛴다
    const v = await L.cmd("GET", `lead:${id}`);
    if (v) { const { token_hash, ...r } = JSON.parse(v); leads.push(r); }
  }
  L.send(res, 200, { events, leads });
};
