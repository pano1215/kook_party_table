// 게스트: 초대 코드로 파티 요약과 내 카드 보기
const L = require("./_lib");
module.exports = async (req, res) => {
  try {
    if (!(await L.limit(req, "invite", 300))) return L.send(res, 429, { error: "잠시 뒤 다시 시도해 주세요." });
    const url = new URL(req.url, "http://x");
    const code = String(url.searchParams.get("code") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const id = code.length === 6 && (await L.cmd("GET", `invite:${code}`));
    const p = id && (await L.getParty(id));
    if (!p) return L.send(res, 404, { error: "초대 코드를 찾을 수 없어요." });
    const cid = url.searchParams.get("card"), tok = req.headers["x-card-token"] || "";
    const mine = cid && tok ? (p.guests || []).find((g) => g.id === cid && g.token_hash === L.sha256(tok)) : null;
    L.send(res, 200, { party: L.forGuest(p, mine) });
  } catch (e) { L.send(res, 500, { error: "서버에서 문제가 생겼어요." }); }
};
