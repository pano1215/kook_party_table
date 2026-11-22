// 게스트: 파티 뒤 설문
const L = require("./_lib");
module.exports = async (req, res) => {
  try {
    const b = await L.body(req);
    const id = await L.cmd("GET", `invite:${String(b.code || "").toUpperCase()}`); const p = id && (await L.getParty(id));
    if (!p) return L.send(res, 404, { error: "파티를 찾을 수 없어요." });
    if (!(p.guests || []).some((g) => g.id === b.card_id && g.token_hash === L.sha256(b.card_token || ""))) return L.send(res, 403, { error: "카드를 보낸 분만 답할 수 있어요." });
    p.feedback = (p.feedback || []).concat({ who: "guest", missed: !!b.missed, note: L.str(b.note, 200), at: new Date().toISOString() });
    p.version += 1; await L.saveParty(p);
    L.send(res, 200, { ok: true });
  } catch (e) { L.send(res, 500, { error: "서버에서 문제가 생겼어요." }); }
};
