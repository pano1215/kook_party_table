// 모꾸 서버 공통: 저장소 + 도우미
// 저장소는 Supabase(Postgres)를 먼저 쓰고, 없으면 Upstash Redis, 둘 다 없으면 메모리(로컬 시험용, 서버를 다시 켜면 사라짐)
const crypto = require("crypto");
// 주소는 https://xxxx.supabase.co 꼴. 뒤에 /rest/v1 이나 빈칸이 붙어 와도 맞춰 쓴다
const SUPA_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
const SUPA_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "").trim();   // 서버 전용 키(브라우저로 나가지 않는다)
const SUPA = !!(SUPA_URL && SUPA_KEY);
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const mem = global.__kookMem || (global.__kookMem = new Map());

async function cmd(...args) {
  if (SUPA) return supaCmd(args);
  if (!URL_) return memCmd(args);
  const r = await fetch(URL_, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}
// ---- Supabase: Redis 명령 몇 가지를 표 두 개(kv, lists)로 옮긴다. 표는 supabase.sql 로 만든다
async function supa(path, { method = "GET", body, prefer } = {}) {
  let r;
  try { r = await fetch(`${SUPA_URL}/rest/v1/${path}`, { method, headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch (e) { throw new Error(`supabase 연결 실패: ${e.message}. SUPABASE_URL 을 확인해 주세요.`); }
  const t = await r.text();
  if (!r.ok) throw new Error(`supabase ${r.status}: ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}
const kq = (k) => `kv?key=eq.${encodeURIComponent(k)}`;
const alive = (row) => !row.expires_at || Date.parse(row.expires_at) > Date.now();
async function supaCmd([c, k, ...a]) {
  c = c.toUpperCase();
  if (c === "GET" || c === "EXISTS") {
    const rows = await supa(`${kq(k)}&select=value,expires_at`);
    const row = rows && rows[0];
    if (row && !alive(row)) { await supa(kq(k), { method: "DELETE" }); return c === "GET" ? null : 0; }   // 기한이 지난 값은 읽을 때 지운다
    return c === "GET" ? (row ? row.value : null) : row ? 1 : 0;
  }
  if (c === "SET") {
    const opt = a.slice(1).map((x) => String(x).toUpperCase());
    let exp = null;
    if (opt.includes("EX")) exp = new Date(Date.now() + +a[1 + opt.indexOf("EX") + 1] * 1000).toISOString();
    if (opt.includes("EXAT")) exp = new Date(+a[1 + opt.indexOf("EXAT") + 1] * 1000).toISOString();
    const row = { key: k, value: String(a[0]), expires_at: exp };
    if (opt.includes("NX")) {
      await supa(`${kq(k)}&expires_at=lt.${encodeURIComponent(new Date().toISOString())}`, { method: "DELETE" });   // 기한 지난 자리는 비운다
      const made = await supa("kv?on_conflict=key", { method: "POST", body: row, prefer: "resolution=ignore-duplicates,return=representation" });
      return made && made.length ? "OK" : null;
    }
    await supa("kv?on_conflict=key", { method: "POST", body: row, prefer: "resolution=merge-duplicates,return=minimal" });
    return "OK";
  }
  if (c === "DEL") { const gone = await supa(kq(k), { method: "DELETE", prefer: "return=representation" }); return gone ? gone.length : 0; }
  if (c === "INCR") return supa("rpc/kv_incr", { method: "POST", body: { k } });
  if (c === "EXPIRE") { await supa(kq(k), { method: "PATCH", body: { expires_at: new Date(Date.now() + +a[0] * 1000).toISOString() }, prefer: "return=minimal" }); return 1; }
  if (c === "EXPIREAT") { await supa(kq(k), { method: "PATCH", body: { expires_at: new Date(+a[0] * 1000).toISOString() }, prefer: "return=minimal" }); return 1; }
  if (c === "LPUSH") { await supa("lists", { method: "POST", body: a.map((v) => ({ name: k, value: String(v) })), prefer: "return=minimal" }); return a.length; }
  if (c === "LTRIM") { await supa("rpc/list_trim", { method: "POST", body: { n: k, keep: +a[1] + 1 } }); return "OK"; }
  if (c === "LRANGE") {   // 최신 것부터. 한 번에 1000줄씩 받아 온다
    const want = +a[1] === -1 ? Infinity : +a[1] + 1, out = [];
    for (let off = +a[0] || 0; out.length < want; off += 1000) {
      const rows = await supa(`lists?name=eq.${encodeURIComponent(k)}&select=value&order=id.desc&limit=${Math.min(1000, want - out.length)}&offset=${off}`);
      out.push(...rows.map((r) => r.value));
      if (rows.length < 1000) break;
    }
    return out;
  }
  throw new Error("unsupported " + c);
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
function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8"); res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Referrer-Policy", "no-referrer");
  res.end(JSON.stringify(body));
}
// 파티로 저장할 수 있는 항목만 골라 형식과 길이를 맞춘다(보낸 그대로 저장하지 않는다)
const METHODS = ["직접 조리", "밀키트", "배달"];
const clampInt = (v, lo, hi, d) => { const n = Math.round(+v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
function cleanParty(q) {
  const methods = arr(q.methods, 3, 10).filter((m) => METHODS.includes(m));
  return {
    name: str(q.name, 30), date: /^\d{4}-\d{2}-\d{2}$/.test(q.date || "") ? q.date : new Date().toISOString().slice(0, 10),
    start: /^\d{2}:\d{2}$/.test(q.start || "") ? q.start : "19:00",
    people: clampInt(q.people, 2, 5, 4), menu_count: clampInt(q.menu_count, 2, 8, 4), budget: clampInt(q.budget, 10000, 1000000, 100000),
    budget_pp: str(q.budget_pp, 30), kinds: arr(q.kinds, 9, 40), mood: str(q.mood, 20), methods: methods.length ? methods : METHODS, notes: str(q.notes, 300),
  };
}
async function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  return await new Promise((ok) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => { try { ok(JSON.parse(d || "{}")); } catch { ok({}); } }); });
}
// 간단한 요청량 제한(IP·이름별, 1시간)
// 요청한 쪽의 IP: Vercel이 직접 채워 주는 값을 먼저 쓴다(브라우저가 보낸 x-forwarded-for 는 꾸밀 수 있다)
const clientIp = (req) => String(req.headers["x-vercel-forwarded-for"] || req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "x").split(",")[0].trim();
async function limit(req, name, max) {
  const ip = clientIp(req);
  const k = `rl:${name}:${ip}:${Math.floor(Date.now() / 3600000)}`;
  const n = await cmd("INCR", k); if (n === 1) await cmd("EXPIRE", k, "3600");
  return n <= max;
}
// 실패 횟수 제한: 틀렸을 때만 센다(bump). 넘었는지는 세지 않고 본다(blocked)
const failKey = (req, name) => `rl:${name}:${clientIp(req)}:${Math.floor(Date.now() / 3600000)}`;
async function blocked(req, name, max) { return +(await cmd("GET", failKey(req, name)) || 0) >= max; }
async function bump(req, name) { const k = failKey(req, name); const n = await cmd("INCR", k); if (n === 1) await cmd("EXPIRE", k, "3600"); }
async function storageCheck() {
  const out = { kind: SUPA ? "supabase" : URL_ ? "upstash" : "memory", ok: false, steps: [] };
  if (SUPA) out.url_ok = /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(SUPA_URL), out.key_kind = SUPA_KEY.startsWith("sb_secret_") ? "secret" : SUPA_KEY.startsWith("sb_publishable_") ? "publishable(브라우저용, 서버용 아님)" : SUPA_KEY.startsWith("eyJ") ? "jwt" : "알 수 없음";
  const k = `check:${rand(4)}`;
  const run = async (name, fn) => { try { const v = await fn(); out.steps.push({ step: name, ok: true }); return v; } catch (e) { out.steps.push({ step: name, ok: false, error: String(e.message || e).slice(0, 300) }); throw e; } };
  try {
    await run("쓰기(kv)", () => cmd("SET", k, "1", "EX", "60"));
    const v = await run("읽기(kv)", () => cmd("GET", k));
    if (v !== "1") throw (out.steps.push({ step: "읽은 값 확인", ok: false, error: `쓴 값이 읽히지 않아요(${v}). 서버용 키가 아니면 이렇게 돼요.` }), new Error("mismatch"));
    await run("숫자 올리기(kv_incr 함수)", () => cmd("INCR", `${k}:n`));
    await run("목록 쓰기(lists)", () => cmd("LPUSH", `${k}:l`, "x"));
    await run("목록 읽기(lists)", () => cmd("LRANGE", `${k}:l`, "0", "0"));
    await run("목록 정리(list_trim 함수)", () => cmd("LTRIM", `${k}:l`, "0", "-1"));   // 시험용 목록을 비운다
    await run("지우기(kv)", () => cmd("DEL", k)); await cmd("DEL", `${k}:n`).catch(() => {});
    out.ok = true;
  } catch {}
  return out;
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
module.exports = { cmd, sha256, rand, getParty, saveParty, forHost, forGuest, hostOk, cleanCard, send, body, limit, str, MAX_CARDS, storageOn: SUPA || !!URL_, storageKind: SUPA ? "supabase" : URL_ ? "upstash" : "memory", storageCheck, safeEq, cleanParty, blocked, bump, arr, normChannel, visitor, logEvent };
