// 호스트가 동의한 기기에만 게스트 카드 도착을 알리는 Web Push 공통 모듈.
// 키값과 구독 endpoint를 로그/응답/이벤트에 노출하지 않는다.
const L = require("./_lib");
const webpush = require("web-push");
const VAPID_PUBLIC_KEY = (process.env.VAPID_PUBLIC_KEY || "").trim();
const VAPID_PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY || "").trim();
const VAPID_SUBJECT = (process.env.VAPID_SUBJECT || "").trim();
function configured() { return !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$|^https:\/\//i.test(VAPID_SUBJECT)); }
function setup() {
  if (!configured()) throw new Error("푸시 알림이 아직 준비되지 않았어요.");
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}
function storageKey(id) { return "push:" + id; }
async function getSubscriptions(p) {
  const raw = await L.cmd("GET", storageKey(p.id));
  try { const a = JSON.parse(raw || "[]"); return Array.isArray(a) ? a.filter(validSubscription).slice(0, 8) : []; }
  catch { return []; }
}
function validSubscription(s) {
  if (!s || typeof s !== "object" || !s.keys || typeof s.keys !== "object") return false;
  if (typeof s.endpoint !== "string" || s.endpoint.length > 2048) return false;
  let url;
  try { url = new URL(s.endpoint); } catch { return false; }
  if (url.protocol !== "https:" || url.port || url.username || url.password) return false;
  // 알 수 없는 서버로 푸시 요청이 전송되지 않도록 Push Service 호스트를 제한한다.
  const host = url.hostname.toLowerCase();
  if (!(host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com" ||
        host === "web.push.apple.com" || host.endsWith(".push.apple.com") ||
        host === "push.services.mozilla.com")) return false;
  return ["p256dh","auth"].every(k => typeof s.keys[k] === "string" && /^[a-zA-Z0-9_-]{8,160}$/.test(s.keys[k]));
}
async function saveSubscriptions(p, list) {
  await L.cmd("SET",storageKey(p.id),JSON.stringify(list.slice(0,8)), "EXAT", String(L.expireAt(p)));
}
function cardNotificationBody(card) {
  // 익명 게스트의 별명은 알림/잠금 화면에 노출하지 않는다.
  const nickname = typeof card?.nickname === "string"
    ? card.nickname.replace(/[\\u0000-\\u001f\\u007f-\\u009f]/g, "").trim().slice(0, 20)
    : "";
  const subject = card?.anonymous || !nickname ? "손님" : nickname;
  return `${subject}의 취향이 도착했어요. 이제 메뉴 추천으로 테이블을 꾸며주세요.`;
}
async function notifyNewCard(p, card) {
  if (!configured()) return;
  let subs;
  try { subs = await getSubscriptions(p); } catch { return; }
  if (!subs.length) return;
  try { setup(); } catch { return; }
  const payload = JSON.stringify({
    title:"모꾸 · 취향 카드 도착 💌",
    body:cardNotificationBody(card),
    url:"/#/host/" + p.id,
    tag:"mokku-card-" + p.id
  });
  const dead = new Set();
  await Promise.allSettled(subs.map(async(s)=>{
    try { await webpush.sendNotification(s,payload,{TTL:3600}); }
    catch(e) { if(e && (e.statusCode===404 || e.statusCode===410)) dead.add(s.endpoint); }
  }));
  if (dead.size) {
    try {
      const latest = await getSubscriptions(p);
      await saveSubscriptions(p,latest.filter(s=>!dead.has(s.endpoint)));
    } catch {}
  }
}
module.exports={configured,setup,validSubscription,getSubscriptions,saveSubscriptions,cardNotificationBody,notifyNewCard};
