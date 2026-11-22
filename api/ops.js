// 운영자: 채널별 핵심 행동 수와 인터뷰 신청 목록 (OPS_KEY 필요)
const L = require("./_lib");
module.exports = async (req, res) => {
  const key = process.env.OPS_KEY || "";
  if (!key || (req.headers["x-ops-key"] || "") !== key) return L.send(res, 401, { error: "운영자 키가 맞지 않아요." });
  const events = ((await L.cmd("LRANGE", "events", "0", "-1")) || []).map((x) => JSON.parse(x));
  const leads = ((await L.cmd("LRANGE", "leads", "0", "-1")) || []).map((x) => JSON.parse(x));
  L.send(res, 200, { events, leads });
};
