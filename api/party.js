// 호스트: 파티 만들기(POST) · 보기(GET) · 고치기(PUT, version 비교) · 지우기(DELETE)
const L = require("./_lib");
module.exports = async (req, res) => {
  try {
    const code = req.headers["x-host-code"] || "";
    const url = new URL(req.url, "http://x");
    if (await L.blocked(req, "hostfail", 40)) return L.send(res, 429, { error: "잠시 뒤 다시 시도해 주세요." });   // 틀린 호스트 코드로 여러 번 시도한 곳은 한 시간 막는다
    if (req.method === "GET") {
      // 호스트 코드로 찾기는 코드를 맞혀 보는 시도를 막으려고 횟수를 제한한다
      if (url.searchParams.get("byhost") && !(await L.limit(req, "byhost", 30))) return L.send(res, 429, { error: "잠시 뒤 다시 시도해 주세요." });
      let p;
      if (url.searchParams.get("byhost")) { const id = await L.cmd("GET", `host:${L.sha256(String(code).toUpperCase().replace(/[^A-Z0-9]/g, ""))}`); p = id && (await L.getParty(id)); }
      else p = await L.getParty(url.searchParams.get("id"));
      if (!p) return L.send(res, 404, { error: "파티를 찾을 수 없어요. 파티일 7일 뒤에는 자동으로 지워져요." });
      if (!L.hostOk(p, code)) { await L.bump(req, "hostfail"); return L.send(res, 403, { error: "호스트 코드가 맞지 않아요." }); }
      return L.send(res, 200, { party: L.forHost(p) });
    }
    if (req.method === "POST") {
      if (!(await L.limit(req, "party", 60))) return L.send(res, 429, { error: "잠시 뒤 다시 시도해 주세요." });
      const { party: q } = await L.body(req);
      if (!q || !/^[a-f0-9]{16}$/.test(q.id || "") || !/^[A-Z0-9]{6}$/.test(q.invite_code || "") || !/^[a-f0-9]{64}$/.test(q.host_hash || "")) return L.send(res, 400, { error: "파티 정보가 올바르지 않아요." });
      if (await L.cmd("GET", `invite:${q.invite_code}`)) return L.send(res, 409, { error: "초대 코드가 겹쳐요. 다시 시도해 주세요." });
      // 이미 있는 파티 ID로는 만들 수 없다(게스트가 알게 된 파티 ID로 남의 파티를 덮어쓰지 못하게)
      if (await L.cmd("GET", `party:${q.id}`)) return L.send(res, 409, { error: "이미 있는 파티예요. 다시 시도해 주세요." });
      if (await L.cmd("GET", `host:${q.host_hash}`)) return L.send(res, 409, { error: "다시 시도해 주세요." });
      const p = { id: q.id, invite_code: q.invite_code, host_hash: q.host_hash, ...L.cleanParty(q), src: L.normChannel(q.src), version: 1, guests: [], plan: null, include_blocked: {}, created_at: new Date().toISOString() };
      if (!p.name) return L.send(res, 400, { error: "파티 이름을 적어 주세요." });
      await L.saveParty(p);
      await L.logEvent(req, "party_created", { ch: p.src, role: "host", party: p.id });   // 핵심 행동 ① 서버가 직접 기록
      return L.send(res, 201, { party: L.forHost(p) });
    }
    if (req.method === "PUT") {
      const { party: q } = await L.body(req);
      const p = q && (await L.getParty(q.id));
      if (!p) return L.send(res, 404, { error: "파티를 찾을 수 없어요." });
      if (!L.hostOk(p, code)) { await L.bump(req, "hostfail"); return L.send(res, 403, { error: "호스트 코드가 맞지 않아요." }); }
      if (q.version !== p.version) return L.send(res, 409, { error: "다른 곳에서 먼저 고쳤어요.", party: L.forHost(p) });
      const old = Object.fromEntries((p.guests || []).map((g) => [g.id, g]));
      const guests = (Array.isArray(q.guests) ? q.guests : []).slice(0, L.MAX_CARDS).map((g) => {
        const prev = old[g.id];
        if (prev) return { ...prev, ...(prev.by_host ? L.cleanCard(g) : {}), by_host: prev.by_host, id: prev.id };   // 게스트가 쓴 카드는 호스트가 바꾸지 못한다
        return { ...L.cleanCard(g), by_host: true, id: L.str(g.id, 20) || L.rand(6), submitted_at: new Date().toISOString() };
      });
      // 호스트가 바꿀 수 있는 항목만 받는다. 코드·유입 채널·만든 시각 같은 값은 서버 것을 그대로 쓴다
      const plan = q.plan && typeof q.plan === "object" && !Array.isArray(q.plan) ? q.plan : null;
      const blocked = q.include_blocked && typeof q.include_blocked === "object" && !Array.isArray(q.include_blocked) ? q.include_blocked : {};
      const next = { id: p.id, invite_code: p.invite_code, host_hash: p.host_hash, created_at: p.created_at, src: p.src, plan_made_at: p.plan_made_at, ...L.cleanParty(q), plan, include_blocked: blocked, guests, version: p.version + 1 };
      // 새 추천인지: 앱이 추천할 때마다 plan.made_at 을 새로 찍는다(알레르기 확인 등으로 다시 저장할 때는 그대로)
      const stamp = (x) => (x && typeof x === "object" ? L.str(x.made_at, 30) || JSON.stringify(x.menus || []) : "");
      const newPlan = !!(next.plan && typeof next.plan === "object") && stamp(next.plan) !== stamp(p.plan);
      if (newPlan && !next.plan_made_at) next.plan_made_at = new Date().toISOString();
      if (!next.plan_made_at) delete next.plan_made_at;
      await L.saveParty(next);
      if (newPlan) await L.logEvent(req, "plan_made", { ch: p.src, role: "host", party: p.id });   // 핵심 행동 ④ 추천할 때마다
      return L.send(res, 200, { party: L.forHost(next) });
    }
    if (req.method === "DELETE") {
      const p = await L.getParty(url.searchParams.get("id"));
      if (!p) return L.send(res, 404, { error: "파티를 찾을 수 없어요." });
      if (!L.hostOk(p, code)) { await L.bump(req, "hostfail"); return L.send(res, 403, { error: "호스트 코드가 맞지 않아요." }); }
      await L.cmd("DEL", `party:${p.id}`); await L.cmd("DEL", `invite:${p.invite_code}`); await L.cmd("DEL", `host:${p.host_hash}`);
      return L.send(res, 200, { ok: true });
    }
    L.send(res, 405, { error: "지원하지 않는 요청이에요." });
  } catch (e) { console.error("[moggu]", req.method, req.url, e && e.message); L.send(res, e.status || 500, { error: e.status ? e.message : "서버에서 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요." }); }
};
