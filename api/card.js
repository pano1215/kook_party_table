// 게스트: 취향 카드 보내기·고치기 (파티당 12장, 카드 수정 토큰)
const L = require("./_lib");
module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return L.send(res, 405, { error: "지원하지 않는 요청이에요." });
    if (!(await L.limit(req, "card", 60))) return L.send(res, 429, { error: "잠시 뒤 다시 시도해 주세요." });
    const b = await L.body(req);
    const code = String(b.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    for (let attempt = 0; attempt < 3; attempt++) {
      const id = await L.cmd("GET", `invite:${code}`); const p = id && (await L.getParty(id));
      if (!p) return L.send(res, 404, { error: "초대 코드를 찾을 수 없어요." });
      const card = L.cleanCard(b.card || {});
      if (!card.nickname) return L.send(res, 400, { error: "별명을 적어 주세요." });
      if (!b.consent) return L.send(res, 400, { error: "동의해야 카드를 보낼 수 있어요." });
      const now = new Date().toISOString();
      let cid = b.card_id, token = b.card_token;
      const i = (p.guests || []).findIndex((g) => g.id === cid && token && g.token_hash === L.sha256(token));
      if (i >= 0) p.guests[i] = { ...card, id: cid, token_hash: p.guests[i].token_hash, submitted_at: now };
      else {
        if ((p.guests || []).length >= L.MAX_CARDS) return L.send(res, 409, { error: "이 파티는 취향 카드를 더 받을 수 없어요." });
        cid = L.rand(6); token = L.rand(16);
        p.guests = (p.guests || []).concat({ ...card, id: cid, token_hash: L.sha256(token), submitted_at: now });
      }
      const fresh = await L.getParty(p.id);           // 그사이 호스트가 고쳤으면 다시 시도
      if (fresh.version !== p.version) continue;
      p.version += 1; await L.saveParty(p);
      if (i < 0) await L.logEvent(req, "card_sent", { ch: p.src, role: "guest", party: p.id });   // 핵심 행동 ③ 새 카드만, 호스트의 채널로 묶는다
      return L.send(res, 200, { id: cid, token, edited: i >= 0 });
    }
    L.send(res, 409, { error: "잠시 뒤 다시 보내 주세요." });
  } catch (e) { L.send(res, 500, { error: "서버에서 문제가 생겼어요." }); }
};
