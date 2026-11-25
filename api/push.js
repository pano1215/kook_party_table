// 호스트 웹 푸시 구독 등록/해지. 게스트는 호스트 인증 없이는 접근할 수 없다.
const L = require("./_lib");
const P = require("./_push");
module.exports = async(req,res)=>{
  try {
    const u = new URL(req.url,"http://x");
    const id = u.searchParams.get("party") || "";
    const p = await L.getParty(id);
    if (!p) return L.send(res,404,{error:"파티를 찾을 수 없어요."});
    if (!L.hostOk(p,req.headers["x-host-code"]||"")) {
      if (!(await L.limit(req,"push-invalid",30))) return L.send(res,429,{error:"잠시 후 다시 시도해 주세요."});
      return L.send(res,403,{error:"호스트만 알림을 설정할 수 있어요."});
    }
    if (req.method==="GET") {
      return L.send(res,200,{enabled:P.configured(),publicKey:P.configured()?process.env.VAPID_PUBLIC_KEY:""});
    }
    if (!["POST","DELETE"].includes(req.method)) return L.send(res,405,{error:"지원하지 않는 요청이에요."});
    if (!P.configured()) return L.send(res,503,{error:"푸시 알림 서버 설정이 아직 완료되지 않았어요."});
    if (!(await L.limit(req,"push",30))) return L.send(res,429,{error:"잠시 뒤 다시 시도해 주세요."});
    const b=await L.body(req);
    const sub=b.subscription;
    if (!P.validSubscription(sub)) return L.send(res,400,{error:"알림 기기 정보가 올바르지 않아요."});
    const list=await P.getSubscriptions(p);
    if(req.method==="DELETE") {
      await P.saveSubscriptions(p,list.filter(s=>s.endpoint!==sub.endpoint));
      return L.send(res,200,{ok:true});
    }
    const next=list.filter(s=>s.endpoint!==sub.endpoint);
    next.push({endpoint:sub.endpoint,keys:{p256dh:sub.keys.p256dh,auth:sub.keys.auth}});
    await P.saveSubscriptions(p,next);
    return L.send(res,200,{ok:true});
  } catch(e) { console.error("[mokku push]",e&&e.message); return L.send(res,500,{error:"알림 설정 중 문제가 생겼어요."}); }
};
