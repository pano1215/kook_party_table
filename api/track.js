// 브라우저가 보내는 기록: 방문(visit)·초대 링크 전달(invite_shared)·배달앱 이동·인터뷰 신청
// 파티 만들기·카드 제출·메뉴 추천은 서버가 해당 API에서 직접 기록하므로 여기서는 받지 않는다(중복·조작 방지)
const L = require("./_lib");
const CLIENT_EVENTS = new Set(["visit", "invite_shared", "delivery_click", "interview_signup"]);
async function findParty(b) {
  if (b.party) return L.getParty(String(b.party));
  const code = String(b.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== 6) return null;
  const id = await L.cmd("GET", `invite:${code}`);
  return id ? L.getParty(id) : null;
}
module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return L.send(res, 405, {});
    if (!(await L.limit(req, "track", 300))) return L.send(res, 429, {});
    const b = await L.body(req), t = new Date().toISOString();
    if (b.kind === "lead") {
      const phone = String(b.phone || "").replace(/[^0-9-]/g, "").slice(0, 20);
      if (phone.replace(/-/g, "").length < 9 || !b.agree) return L.send(res, 400, { error: "연락처와 동의를 확인해 주세요." });
      const p = await findParty(b);
      await L.cmd("LPUSH", "leads", JSON.stringify({ t, role: L.str(b.role, 10), party: L.str(b.party, 20), phone, src: p ? p.src : L.normChannel(b.ch || b.src) }));
      return L.send(res, 200, { ok: true });
    }
    if (!CLIENT_EVENTS.has(b.ev)) return L.send(res, 400, { error: "기록할 수 없는 행동이에요." });
    const role = b.role === "guest" ? "guest" : "host";
    const p = await findParty(b);
    // 파티에 딸린 행동은 호스트가 들어온 채널로 묶는다. 호스트의 첫 방문만 자기 링크의 채널을 쓴다
    const ch = p && !(b.ev === "visit" && role === "host") ? p.src : b.ch;
    if (b.ev === "invite_shared") {
      if (!p) return L.send(res, 404, {});
      if (!(await L.cmd("SET", `once:shared:${p.id}`, "1", "NX", "EX", String(30 * 86400)))) return L.send(res, 200, { ok: true, dup: true });   // 파티당 한 번
    }
    await L.logEvent(req, b.ev, { ch, role, party: p ? p.id : "" });
    L.send(res, 200, { ok: true });
  } catch (e) { L.send(res, 500, {}); }
};
