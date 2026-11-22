// 쿸 서버 공통: 저장소(Upstash Redis REST) + 도우미
// 환경변수가 없으면 메모리에 저장한다(로컬 시험용, 서버를 다시 켜면 사라짐)
const crypto = require("crypto");
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const mem = global.__kookMem || (global.__kookMem = new Map());

async function cmd(...args) {
  if (!URL_) return memCmd(args);
  const r = await fetch(URL_, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}
function memCmd([c, k, ...a]) {
  c = c.toUpperCase();
  if (c === "GET") return mem.has(k) ? mem.get(k) : null;
  if (c === "SET") { if (a.includes("NX") && mem.has(k)) return null; mem.set(k, a[0]); return "OK"; }
  if (c === "EXISTS") return mem.has(k) ? 1 : 0;
  if (c === "DEL") return mem.delete(k) ? 1 : 0;
  if (c === "INCR") { const v = (+mem.get(k) || 0) + 1; mem.set(k, String(v)); return v; }
  if (c === "EXPIRE" || c === "EXPIREAT") return 1;
  if (c === "LPUSH") { const l = mem.get(k) || []; l.unshift(...a); mem.set(k, l); return l.length; }
  if (c === "LTRIM") { const l = mem.get(k) || []; mem.set(k, l.slice(+a[0], +a[1] + 1)); return "OK"; }
  if (c === "LRANGE") { const l = mem.get(k) || []; return l.slice(+a[0], +a[1] === -1 ? undefined : +a[1] + 1); }
  throw new Error("unsupported " + c);
}

const sha256 = (s) => crypto.createHash("sha256").update(String(s), "utf8").digest("hex");
const rand = (n) => crypto.randomBytes(n).toString("hex");
const safeEq = (a, b) => { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); };
// 파티일 + 7일에 자동 삭제
function expireAt(party) {
  const t = Date.parse(`${party.date || ""}T23:59:59+09:00`);
  const base = isNaN(t) ? Date.now() : t;
  return Math.floor(base / 1000) + 7 * 86400;
}
async function getParty(id) { if (!/^[a-f0-9]{16}$/.test(id || "")) return null; const v = await cmd("GET", `party:${id}`); return v ? JSON.parse(v) : null; }
async function saveParty(p) {
  const s = JSON.stringify(p);
  if (s.length > 300000) throw Object.assign(new Error("파티 데이터가 너무 커요."), { status: 413 });
  const at = String(expireAt(p));
  await cmd("SET", `party:${p.id}`, s, "EXAT", at);
  await cmd("SET", `invite:${p.invite_code}`, p.id, "EXAT", at);
  await cmd("SET", `host:${p.host_hash}`, p.id, "EXAT", at);
}
// 호스트에게 줄 때: 토큰 해시는 빼고 준다
function forHost(p) { const { host_hash, ...rest } = p; return { ...rest, guests: (p.guests || []).map(({ token_hash, ...g }) => g) }; }
// 게스트에게 줄 때: 파티 요약과 자기 카드만
function forGuest(p, mine) {
  return { id: p.id, name: p.name, date: p.date, start: p.start, people: p.people, mood: p.mood, invite_code: p.invite_code, plan: p.plan ? true : null,
    cards: (p.guests || []).length, guests: mine ? [(({ token_hash, ...g }) => g)(mine)] : [] };
}
function hostOk(p, code) { return p && code && safeEq(p.host_hash, sha256(String(code).toUpperCase().replace(/[^A-Z0-9]/g, ""))); }
const str = (v, n) => String(v ?? "").trim().slice(0, n);
const arr = (v, n = 20, m = 30) => (Array.isArray(v) ? v : []).map((x) => str(x, m)).filter(Boolean).slice(0, n);
function cleanCard(c) {
  return { nickname: str(c.nickname, 20), anonymous: !!c.anonymous, allergies: arr(c.allergies), dislikes: arr(c.dislikes), likes: arr(c.likes),
    spice: str(c.spice, 30), drink: str(c.drink, 30), message: str(c.message, 100), src: str(c.src, 30), by_host: false };
}
function send(res, status, body) { res.statusCode = status; res.setHeader("Content-Type", "application/json; charset=utf-8"); res.setHeader("Cache-Control", "no-store"); res.end(JSON.stringify(body)); }
async function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  return await new Promise((ok) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => { try { ok(JSON.parse(d || "{}")); } catch { ok({}); } }); });
}
// 간단한 요청량 제한(IP·이름별, 1시간)
async function limit(req, name, max) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "x").split(",")[0].trim();
  const k = `rl:${name}:${ip}:${Math.floor(Date.now() / 3600000)}`;
  const n = await cmd("INCR", k); if (n === 1) await cmd("EXPIRE", k, "3600");
  return n <= max;
}
const MAX_CARDS = 12;

// ---- 유입 경로(채널)와 핵심 행동 기록
// 링크의 ?src= 값을 정해진 채널 키로 맞춘다. 정해진 6개 + 초대받은 게스트(invite) + 직접 방문(direct) + 기타(other)
const CHANNELS = [["instagram", /^(instagram|insta|ig|인스타)/i], ["friend", /^(friend|지인|ref)/i], ["kakao", /^(kakao|openchat|오픈챗|카카오)/i],
  ["threads", /^(threads|스레드)/i], ["naver_cafe", /^(naver_?cafe|ncafe|cafe|카페)/i], ["naver_blog", /^(naver_?blog|nblog|blog|블로그)/i]];
const FIXED = new Set(["invite", "direct", "other"]);
function normChannel(raw) {
  const v = String(raw || "").trim().slice(0, 30);
  if (!v) return "direct";
  if (FIXED.has(v)) return v;
  const hit = CHANNELS.find(([, re]) => re.test(v));
  return hit ? hit[0] : "other";
}
// 익명 방문자 ID: 브라우저마다 만든 16자리 무작위 값. 이름·연락처와 연결되지 않는다
const visitor = (req) => { const v = String(req.headers["x-visitor"] || ""); return /^[a-f0-9]{16}$/.test(v) ? v : ""; };
// 이벤트 한 줄: { t, ev, ch, role, vid, party }. 최근 5만 건만 남긴다
async function logEvent(req, ev, { ch, role, party, kind } = {}) {
  try {
    const e = { t: new Date().toISOString(), ev, ch: normChannel(ch), role: role || "", vid: visitor(req), party: str(party, 20) };
    if (kind) e.kind = str(kind, 20);
    await cmd("LPUSH", "events", JSON.stringify(e));
    await cmd("LTRIM", "events", "0", "49999");
  } catch {}   // 기록이 실패해도 본래 요청은 성공시킨다
}
module.exports = { cmd, sha256, rand, getParty, saveParty, forHost, forGuest, hostOk, cleanCard, send, body, limit, str, MAX_CARDS, storageOn: !!URL_, arr, normChannel, visitor, logEvent };
