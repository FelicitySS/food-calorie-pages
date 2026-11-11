const API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const MODEL = 'qwen3-vl-plus';
const MAX_IMAGE_LENGTH = 7_000_000;
const MAX_BODY_LENGTH = MAX_IMAGE_LENGTH + 2048;

const SYSTEM_PROMPT = `你是一个食物图片营养估算助手。请观察图片中明显可见的食物，按照普通中国人一份餐食的常见份量估算重量(克)和热量(千卡)。
要求：
1. 只输出 JSON 对象，格式严格为 {"is_food":true,"items":[{"name":"鸡胸肉","grams":80,"kcal":132}]}；如不是食物或无法判断，输出 {"is_food":false,"items":[]}。
2. name 是简短中文食物名称，grams 和 kcal 必须是非负整数，分别是这项食物的估算克数和估算总千卡数，不是每 100g 热量。
3. 图片无法称重，估算要克制。不能看到的食物不要猜测；烹饪用油/酱汁如果明显可见，可作为独立项目或者计入对应菜品，避免重复计算。
4. 同一食物不要重复列出；只分析真正能看见的食物，不要解释、不要 markdown、不输出 total。`;

const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}
function parseResult(content) {
  if (typeof content !== 'string') throw new Error('模型未返回文本');
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let result;
  try { result = JSON.parse(cleaned); }
  catch { throw new Error('模型没有返回有效 JSON'); }
  if (!result || !Array.isArray(result.items)) throw new Error('模型返回字段不完整');
  if (result.is_food === false) return { is_food: false, items: [], total_kcal: 0 };
  const items = result.items.slice(0, 20).map((item) => {
    const name = typeof item?.name === 'string' ? item.name.trim().slice(0, 40) : '';
    const grams = Number(item?.grams);
    const kcal = Number(item?.kcal);
    if (!name || !Number.isFinite(grams) || !Number.isFinite(kcal)
      || grams < 1 || grams > 5000 || kcal < 0 || kcal > 10000) return null;
    return { name, grams: Math.round(grams), kcal: Math.round(kcal) };
  }).filter(Boolean);
  if (!items.length) return { is_food: false, items: [], total_kcal: 0 };
  return { is_food: true, items, total_kcal: items.reduce((sum, item) => sum + item.kcal, 0) };
}

export async function onRequestPost({ request, env }) {
  if (!env.DASHSCOPE_API_KEY) return json({ error: '管理员尚未配置 DASHSCOPE_API_KEY。' }, 503);
  if (env.SITE_ACCESS_CODE && request.headers.get('X-Access-Code') !== env.SITE_ACCESS_CODE) {
    return json({ error: '访问码不正确。' }, 403);
  }
  if ((Number(request.headers.get('content-length')) || 0) > MAX_BODY_LENGTH) {
    return json({ error: '照片太大，请重新拍摄。' }, 413);
  }

  let payload;
  try { payload = await request.json(); }
  catch { return json({ error: '请求格式错误。' }, 400); }
  const image = payload?.image;
  if (typeof image !== 'string' || image.length > MAX_IMAGE_LENGTH
      || !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) {
    return json({ error: '图片格式或大小不符合要求，请换一张 JPG / PNG / WebP 照片。' }, 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35000);
  try {
    const upstream = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.DASHSCOPE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: [
            { type: 'text', text: '请识别图片中的食物并以 JSON 返回估算重量(grams)和热量(kcal)。' },
            { type: 'image_url', image_url: { url: image } }
          ] }
        ],
        response_format: { type: 'json_object' },
        stream: false
      }),
      signal: controller.signal
    });

    const data = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      if (upstream.status === 429) return json({ error: '模型请求过于频繁，请稍后重试。' }, 429);
      if (upstream.status === 401 || upstream.status === 403) return json({ error: '阿里云 API Key 无效、地域错误或无模型权限。' }, 502);
      if (upstream.status === 400) return json({ error: '模型拒绝此次请求，请检查图片或模型开通状态。' }, 502);
      return json({ error: `模型调用失败（HTTP ${upstream.status}）。` }, 502);
    }
    const content = data?.choices?.[0]?.message?.content;
    let result;
    try { result = parseResult(content); }
    catch { return json({ error: 'AI 返回的结果格式异常，请重新拍摄重试。' }, 502); }
    return json(result);
  } catch (err) {
    if (err?.name === 'AbortError') return json({ error: '模型响应超时，请稍后重试。' }, 504);
    return json({ error: '连接模型服务失败，请检查网络或稍后重试。' }, 502);
  } finally {
    clearTimeout(timeout);
  }
}
