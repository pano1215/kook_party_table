const L = require("./_lib");
module.exports = async (req, res) => L.send(res, 200, { ai: !!process.env.GROQ_API_KEY, storage: L.storageOn, kakao: process.env.KAKAO_JS_KEY || "" });
