'use strict';

const $ = (id) => document.getElementById(id);
const cameraInput = $('cameraInput');
const galleryInput = $('galleryInput');
const analyzeButton = $('analyzeButton');
const statusMessage = $('statusMessage');
const modelOptions = $('modelOptions');
let imageDataUrl = null;
let working = false;

// 识别模型选择：GLM（智谱 glm-4.6v-flash）/ Qwen（阿里云百炼 qwen3-vl-plus），记住上次选择
let selectedModel = 'qwen';
try {
  const saved = localStorage.getItem('food-lens-model');
  if (saved && modelOptions.querySelector(`[data-model="${saved}"]`)) selectedModel = saved;
} catch { /* localStorage 不可用时用默认模型 */ }
function renderModelOptions() {
  for (const btn of modelOptions.querySelectorAll('.model-option')) {
    const active = btn.dataset.model === selectedModel;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-checked', String(active));
    btn.disabled = working;
  }
}
modelOptions.addEventListener('click', (event) => {
  const btn = event.target.closest('.model-option');
  if (!btn || working) return;
  selectedModel = btn.dataset.model;
  try { localStorage.setItem('food-lens-model', selectedModel); } catch { /* 忽略 */ }
  renderModelOptions();
});
renderModelOptions();

$('cameraButton').addEventListener('click', () => { if (!working) cameraInput.click(); });
$('galleryButton').addEventListener('click', () => { if (!working) galleryInput.click(); });
cameraInput.addEventListener('change', async () => {
  const file = cameraInput.files?.[0];
  cameraInput.value = '';
  if (file) await selectImage(file);
});
galleryInput.addEventListener('change', async () => {
  const file = galleryInput.files?.[0];
  galleryInput.value = '';
  if (file) await selectImage(file);
});
analyzeButton.addEventListener('click', analyze);

function showStatus(text, isError = false) {
  statusMessage.textContent = text;
  statusMessage.classList.toggle('error', isError);
}
function setWorking(value) {
  working = value;
  analyzeButton.disabled = value || !imageDataUrl;
  $('cameraButton').disabled = value;
  $('galleryButton').disabled = value;
  renderModelOptions();
  $('buttonText').textContent = value ? '正在分析，请稍候…' : imageDataUrl ? '确认并分析' : '先拍摄或选择照片';
  $('buttonArrow').hidden = value;
}
function resetResult() {
  $('resultData').hidden = true;
  $('nonFood').hidden = true;
  $('resultEmpty').hidden = false;
  $('foodList').replaceChildren();
}

async function selectImage(file) {
  if (!file.type.startsWith('image/')) {
    showStatus('请选择一张图片。', true);
    return;
  }
  if (file.size > 25 * 1024 * 1024) {
    showStatus('图片太大，请选择小于 25 MB 的照片。', true);
    return;
  }
  showStatus('正在处理照片…');
  analyzeButton.disabled = true;
  try {
    imageDataUrl = await optimizeImage(file);
    $('preview').src = imageDataUrl;
    $('preview').hidden = false;
    $('emptyPhoto').hidden = true;
    $('photoTag').hidden = false;
    resetResult();
    showStatus('照片已准备好，点击确认并分析。');
  } catch (err) {
    imageDataUrl = null;
    showStatus(err.message || '图片处理失败，请换一张重试。', true);
  } finally {
    setWorking(false);
  }
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('无法读取这张照片，请尝试 JPG / PNG 格式。')); };
    image.src = url;
  });
}

async function optimizeImage(file) {
  const image = await loadImage(file);
  const maxEdge = 1600;
  const ratio = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器不支持图片压缩。');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const result = canvas.toDataURL('image/jpeg', 0.83);
  if (!result.startsWith('data:image/jpeg;base64,')) throw new Error('图片压缩失败。');
  if (result.length > 7_000_000) throw new Error('压缩后图片仍然过大，请使用更小的照片。');
  return result;
}

async function analyze() {
  if (working || !imageDataUrl) return;
  setWorking(true);
  resetResult();
  showStatus('正在识别食物与热量…');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Access-Code': $('accessCode').value.trim()
      },
      body: JSON.stringify({ image: imageDataUrl, model: selectedModel }),
      signal: controller.signal
    });
    let data;
    try { data = await response.json(); }
    catch { throw new Error(`服务返回异常（HTTP ${response.status}），请确认已正确部署 Pages Functions。`); }
    if (!response.ok) throw new Error(data.error || `分析失败（HTTP ${response.status}）`);
    renderResult(data);
    showStatus('分析完成');
  } catch (err) {
    showStatus(err.name === 'AbortError' ? '分析超时，请稍后重试。' : (err.message || '网络异常，请重试。'), true);
  } finally {
    clearTimeout(timeoutId);
    setWorking(false);
  }
}

function renderResult(data) {
  $('resultEmpty').hidden = true;
  if (!data.is_food || !Array.isArray(data.items) || !data.items.length) {
    $('nonFood').hidden = false;
    return;
  }
  const list = $('foodList');
  const total = data.items.reduce((sum, item) => sum + item.kcal, 0);
  for (const item of data.items) {
    const row = document.createElement('div');
    row.className = 'food-row';
    const left = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'food-name';
    name.textContent = item.name;
    const grams = document.createElement('div');
    grams.className = 'food-grams';
    grams.textContent = `${item.grams} g`;
    left.append(name, grams);
    const kcal = document.createElement('div');
    kcal.className = 'food-calories';
    kcal.textContent = String(item.kcal);
    const unit = document.createElement('small');
    unit.textContent = 'kcal';
    kcal.append(unit);
    row.append(left, kcal);
    list.append(row);
  }
  $('totalKcal').textContent = String(total);
  $('totalDesc').textContent = `共 ${data.items.length} 项食物`;
  $('resultData').hidden = false;
}
