// 인터뷰 신청: 휴대폰 번호와 동의 기록을 서버에 저장한다(90일 뒤 자동 삭제, 신청자가 직접 취소 가능)
const L = require("./_lib");
const NOTICE = "2026-11-22.2";          // 개인정보 수집·이용 안내 문구 버전. 문구를 바꾸면 날짜도 바꾼다(앱의 LEAD_NOTICE와 같아야 함)
const KEEP_DAYS = 90;
module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    if (req.method === "POST") {
      if (!(await L.limit(req, "lead", 10))) return L.send(res, 429, { error: "잠시 뒤 다시 시도해 주세요." });
      const b = await L.body(req);
      const digits = String(b.phone || "").replace(/[^0-9]/g, "");
      if (!/^01[016789][0-9]{7,8}$/.test(digits)) return L.send(res, 400, { error: "휴대폰 번호를 확인해 주세요. (예: 010-1234-5678)" });
      if (b.agree !== true) return L.send(res, 400, { error: "개인정보 수집·이용에 동의해야 신청할 수 있어요." });
      if (b.notice !== NOTICE) return L.send(res, 409, { error: "안내 문구가 바뀌었어요. 화면을 새로고침한 뒤 다시 신청해 주세요." });
      const p = b.party ? await L.getParty(String(b.party)) : null;
      const t = new Date().toISOString(), id = L.rand(8), token = L.rand(16);
      const phone = digits.replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3");
      const rec = { id, t, role: b.role === "guest" ? "guest" : "host", party: p ? p.id : "", phone, src: p ? p.src : L.normChannel(b.ch),
        consent: { agreed: true, at: t, notice: NOTICE, items: "휴대폰 번호", purpose: "모꾸 사용자 인터뷰 일정 안내와 사례 지급 연락", keep_days: KEEP_DAYS }, token_hash: L.sha256(token) };
      await L.cmd("SET", `lead:${id}`, JSON.stringify(rec), "EX", String(KEEP_DAYS * 86400));
      await L.cmd("LPUSH", "leadids", id); await L.cmd("LTRIM", "leadids", "0", "4999");
      await L.logEvent(req, "interview_signup", { ch: rec.src, role: rec.role, party: rec.party });
      return L.send(res, 201, { id, token, keep_days: KEEP_DAYS });
    }
    if (req.method === "DELETE") {       // 신청 취소 = 동의 철회: 기록을 바로 지운다
      const id = String(url.searchParams.get("id") || ""), tok = String(req.headers["x-lead-token"] || "");
      const v = /^[a-f0-9]{16}$/.test(id) ? await L.cmd("GET", `lead:${id}`) : null;
      if (!v) return L.send(res, 200, { ok: true });
      if (JSON.parse(v).token_hash !== L.sha256(tok)) return L.send(res, 403, { error: "신청한 기기에서만 취소할 수 있어요." });
      await L.cmd("DEL", `lead:${id}`);
      return L.send(res, 200, { ok: true });
    }
    L.send(res, 405, { error: "지원하지 않는 요청이에요." });
  } catch (e) { console.error("[moggu]", req.method, req.url, e && e.message); L.send(res, 500, { error: "서버에서 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요." }); }
};
