import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('../functions/api/analyze.js', import.meta.url), 'utf8');
const { onRequestPost } = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(source));
const image = 'data:image/jpeg;base64,AAAA';
function request(data = { image, model: 'qwen' }, code = '') {
  return new Request('https://example.pages.dev/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Access-Code': code },
    body: JSON.stringify(data)
  });
}
function upstream(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}
async function check(req, env) {
  const res = await onRequestPost({ request: req, env });
  return [res.status, await res.json()];
}

const QWEN_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const GLM_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
let calls = 0;
let lastUrl = null;
let lastModel = null;
let lastBody = null;
let lastAuth = null;
function mockOk(content) {
  return async (url, init) => {
    calls++;
    lastUrl = url;
    lastAuth = init.headers.Authorization;
    lastBody = JSON.parse(init.body);
    lastModel = lastBody.model;
    assert.equal(lastBody.messages[1].content[1].image_url.url, image);
    return upstream(200, { choices: [{ message: { content } }] });
  };
}
const FOOD_JSON = '{"is_food":true,"items":[{"name":"鸡胸肉","grams":80,"kcal":132},{"name":"米饭","grams":150,"kcal":174}]}';

{
  // Qwen 路由：阿里云百炼 + qwen3-vl-plus（可用 QWEN_MODEL 覆盖）+ response_format
  globalThis.fetch = mockOk(FOOD_JSON);
  const [status, data] = await check(request(), { DASHSCOPE_API_KEY: 'sk-qwen' });
  assert.equal(status, 200);
  assert.equal(data.total_kcal, 306);
  assert.equal(data.items.length, 2);
  assert.equal(lastUrl, QWEN_URL);
  assert.equal(lastModel, 'qwen3-vl-plus');
  assert.equal(lastAuth, 'Bearer sk-qwen');
  assert.equal(lastBody.response_format.type, 'json_object');
  assert.equal(calls, 1);
}
{
  // Qwen 模型 ID 可用 QWEN_MODEL 环境变量切换
  globalThis.fetch = mockOk(FOOD_JSON);
  await check(request(), { DASHSCOPE_API_KEY: 'sk-qwen', QWEN_MODEL: 'qwen3-vl-flash' });
  assert.equal(lastModel, 'qwen3-vl-flash');
}
{
  // GLM 路由：智谱 + glm-4.6v-flash（可用 GLM_MODEL 覆盖）+ thinking 关闭，content 为分段数组也能解析
  globalThis.fetch = mockOk([{ type: 'text', text: FOOD_JSON }]);
  const [status, data] = await check(request({ image, model: 'glm' }), { GLM_API_KEY: 'sk-glm' });
  assert.equal(status, 200);
  assert.equal(data.total_kcal, 306);
  assert.equal(lastUrl, GLM_URL);
  assert.equal(lastModel, 'glm-4.6v-flash');
  assert.equal(lastAuth, 'Bearer sk-glm');
  assert.deepEqual(lastBody.thinking, { type: 'disabled' });
  assert.equal(lastBody.max_tokens, 2048);
  assert.equal(lastBody.response_format, undefined);
}
{
  // GLM 模型 ID 可用 GLM_MODEL 环境变量切换
  globalThis.fetch = mockOk(FOOD_JSON);
  await check(request({ image, model: 'glm' }), { GLM_API_KEY: 'sk-glm', GLM_MODEL: 'glm-4.5v' });
  assert.equal(lastModel, 'glm-4.5v');
}
{
  // 不传 model 或传了未知值时回退默认 Qwen
  globalThis.fetch = mockOk(FOOD_JSON);
  await check(request({ image, model: 'gpt-4o' }), { DASHSCOPE_API_KEY: 'sk-qwen' });
  assert.equal(lastUrl, QWEN_URL);
  await check(request({ image }), { DASHSCOPE_API_KEY: 'sk-qwen' });
  assert.equal(lastUrl, QWEN_URL);
}
{
  // 各自缺少对应 Key 时提示配置哪个变量
  const [status, data] = await check(request(), {});
  assert.equal(status, 503);
  assert.match(data.error, /DASHSCOPE_API_KEY/);
  const [status2, data2] = await check(request({ image, model: 'glm' }), { DASHSCOPE_API_KEY: 'sk-qwen' });
  assert.equal(status2, 503);
  assert.match(data2.error, /GLM_API_KEY/);
}
{
  // 访问码 / 图片格式校验
  const [status] = await check(request(), { DASHSCOPE_API_KEY: 'sk-qwen', SITE_ACCESS_CODE: '1234' });
  assert.equal(status, 403);
  const [status2] = await check(request({ image: 'bad-image' }), { DASHSCOPE_API_KEY: 'sk-qwen' });
  assert.equal(status2, 400);
}
{
  globalThis.fetch = async () => upstream(429, { error: { message: 'rate limited' } });
  const [status, data] = await check(request(), { DASHSCOPE_API_KEY: 'sk-qwen' });
  assert.equal(status, 429);
  assert.match(data.error, /频繁/);
}
{
  globalThis.fetch = async () => upstream(200, { choices: [{ message: { content: 'invalid json' } }] });
  const [status, data] = await check(request(), { DASHSCOPE_API_KEY: 'sk-qwen' });
  assert.equal(status, 502);
  assert.match(data.error, /格式异常/);
}
{
  // 模型不存在/未开通（404）时提示模型名和厂商
  globalThis.fetch = async () => upstream(404, { error: { message: 'Model not found' } });
  const [status, data] = await check(request({ image, model: 'glm' }), { GLM_API_KEY: 'sk-glm' });
  assert.equal(status, 502);
  assert.match(data.error, /glm-4.6v-flash/);
  assert.match(data.error, /不存在|未开通/);
  assert.match(data.error, /智谱/);
}
{
  // 非食物图片
  globalThis.fetch = mockOk('{"is_food":false,"items":[]}');
  const [status, data] = await check(request(), { DASHSCOPE_API_KEY: 'sk-qwen' });
  assert.equal(status, 200);
  assert.equal(data.is_food, false);
}
console.log('All 11 API tests passed');
