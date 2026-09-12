import { Scanner, decodeImageFile } from './scanner.js';
import { parseContent, TYPE_LABELS } from './parse.js';

const $ = (id) => document.getElementById(id);

const el = {
  video: $('video'),
  overlay: $('overlay'),
  stageInner: $('stage-inner'),
  stageState: $('stage-state'),
  stageTitle: $('stage-title'),
  stageNote: $('stage-note'),
  stageAction: $('stage-action'),
  btnToggle: $('btn-toggle'),
  btnImage: $('btn-image'),
  cameraSelect: $('camera-select'),
  optSound: $('opt-sound'),
  optMirror: $('opt-mirror'),
  historyList: $('history-list'),
  historyEmpty: $('history-empty'),
  historyCount: $('history-count'),
  historySearch: $('history-search'),
  historyPath: $('history-path'),
  modal: $('modal'),
  modalType: $('modal-type'),
  modalSource: $('modal-source'),
  modalTitle: $('modal-title'),
  modalWarn: $('modal-warn'),
  modalFields: $('modal-fields'),
  modalRaw: $('modal-raw'),
  modalActions: $('modal-actions'),
  modalFoot: $('modal-foot'),
  dropzone: $('dropzone'),
  toast: $('toast'),
};

const state = {
  history: [],
  filter: '',
  modalOpen: false,
  cameraId: null,
  dragDepth: 0,
};

const PREFS_KEY = 'qr-reader-prefs';
const IS_MAC = window.qr.platform === 'darwin';

// OS ごとのカメラ許可の案内
const CAMERA_PERMISSION_NOTE = {
  darwin: 'システム設定 →「プライバシーとセキュリティ」→「カメラ」でこのアプリ（開発中は Electron / ターミナル）を許可したあと、アプリを再起動してください。',
  win32: '設定 →「プライバシーとセキュリティ」→「カメラ」で「カメラへのアクセス」と「デスクトップ アプリがカメラにアクセスできるようにする」をオンにしたあと、アプリを再起動してください。',
}[window.qr.platform] ?? 'OS のカメラ設定でこのアプリの使用を許可したあと、アプリを再起動してください。';

/* ------------------------- 汎用 UI ------------------------- */

let toastTimer = null;
function toast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2200);
}

function showStage({ title, note = '', action = null }) {
  el.stageTitle.textContent = title;
  el.stageNote.textContent = note;
  el.stageState.hidden = false;
  el.stageInner.classList.remove('is-live');
  if (action) {
    el.stageAction.textContent = action.label;
    el.stageAction.hidden = false;
    el.stageAction.onclick = action.onClick;
  } else {
    el.stageAction.hidden = true;
    el.stageAction.onclick = null;
  }
}

function showLive() {
  el.stageState.hidden = true;
  el.stageInner.classList.add('is-live');
}

/* ------------------------- 読み取り音 ------------------------- */

let audioContext = null;
function beep() {
  if (!el.optSound.checked) return;
  try {
    audioContext = audioContext ?? new AudioContext();
    if (audioContext.state === 'suspended') audioContext.resume();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 1180;
    gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, audioContext.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.13);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.14);
  } catch { /* 音が出せなくても読み取りは続行する */ }
}

/* ------------------------- スキャナ ------------------------- */

const scanner = new Scanner({
  video: el.video,
  overlay: el.overlay,
  onResult: ({ text, source }) => { handleResult(text, source); },
  onStatus: ({ running }) => {
    el.btnToggle.textContent = running ? 'スキャン停止' : 'スキャン開始';
  },
});

async function startCamera(deviceId) {
  showStage({ title: 'カメラを起動しています…' });
  try {
    const activeId = await scanner.start(deviceId);
    state.cameraId = activeId;
    showLive();
    await refreshCameraList();
    savePrefs();
  } catch (error) {
    handleCameraError(error);
    await refreshCameraList();
  }
}

function handleCameraError(error) {
  const name = error?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    showStage({
      title: 'カメラの使用が許可されていません',
      note: `${CAMERA_PERMISSION_NOTE}画像ファイルからの読み取りは許可なしで利用できます。`,
      action: { label: 'もう一度試す', onClick: () => startCamera(state.cameraId) },
    });
  } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    showStage({
      title: '利用できるカメラが見つかりません',
      note: 'カメラを接続してから再試行してください。画像ファイルからの読み取りはそのまま利用できます。',
      action: { label: '再検出', onClick: () => startCamera(null) },
    });
  } else {
    showStage({
      title: 'カメラを起動できませんでした',
      note: String(error?.message ?? error),
      action: { label: 'もう一度試す', onClick: () => startCamera(state.cameraId) },
    });
  }
}

async function refreshCameraList() {
  let cameras = [];
  try {
    cameras = await scanner.listCameras();
  } catch { /* 列挙に失敗しても既定カメラでの動作は続行する */ }

  el.cameraSelect.textContent = '';
  if (cameras.length === 0) {
    el.cameraSelect.append(new Option('カメラなし', ''));
    el.cameraSelect.disabled = true;
    return;
  }
  cameras.forEach((camera, index) => {
    el.cameraSelect.append(new Option(camera.label || `カメラ ${index + 1}`, camera.deviceId));
  });
  el.cameraSelect.disabled = false;
  if (state.cameraId && cameras.some((c) => c.deviceId === state.cameraId)) {
    el.cameraSelect.value = state.cameraId;
  }
}

/* ------------------------- 読み取り結果 ------------------------- */

async function handleResult(text, source) {
  beep();
  scanner.pause();
  const entry = await window.qr.history.add({ text, type: parseContent(text).type, source });
  state.history.unshift(entry);
  renderHistory();
  openModal(entry, { saved: true });
}

function openModal(entry, { saved = false } = {}) {
  const parsed = parseContent(entry.text);
  state.modalOpen = true;
  scanner.pause();

  el.modalType.textContent = parsed.label;
  el.modalSource.textContent = `${entry.source === 'image' ? '画像' : 'カメラ'}・${formatTime(entry.createdAt)}`;
  el.modalTitle.textContent = parsed.summary || entry.text;
  el.modalRaw.textContent = entry.text;
  el.modalFoot.textContent = saved
    ? '読み取った内容は履歴に自動保存されました。'
    : '履歴に保存済みの内容です。';

  renderWarning(parsed);
  renderFields(parsed);
  renderActions(entry, parsed);

  el.modal.hidden = false;
  // 誤操作で外部アプリを開かないよう、初期フォーカスは「閉じる」に置く
  document.getElementById('modal-close').focus();
}

function renderWarning(parsed) {
  const messages = [];
  if (parsed.needsScheme) {
    messages.push('スキームが含まれていないため、https:// を補って開きます。');
  }
  if (parsed.isUrl && parsed.openUrl) {
    try {
      const host = new URL(parsed.openUrl).hostname;
      if (/[^\x00-\x7F]/.test(host) || host.startsWith('xn--') || host.includes('.xn--')) {
        messages.push('国際化ドメイン名です。見た目が似た別サイトの可能性があるため、開く前にURLをよく確認してください。');
      }
    } catch { /* URL として解釈できない場合は警告を出さない */ }
  }
  el.modalWarn.textContent = messages.join(' ');
  el.modalWarn.hidden = messages.length === 0;
}

function renderFields(parsed) {
  el.modalFields.textContent = '';
  for (const field of parsed.fields) {
    const row = document.createElement('div');
    row.className = 'field-row';

    const term = document.createElement('dt');
    term.textContent = field.label;

    const detail = document.createElement('dd');
    detail.textContent = field.value;

    if (field.copyable) {
      const copy = document.createElement('button');
      copy.className = 'link-button';
      copy.textContent = 'コピー';
      copy.onclick = () => copyText(field.value);
      detail.append(' ', copy);
    }
    if (field.action) {
      const open = document.createElement('button');
      open.className = 'link-button';
      open.textContent = '開く';
      open.onclick = () => openExternal(field.action);
      detail.append(' ', open);
    }
    row.append(term, detail);
    el.modalFields.append(row);
  }
}

function renderActions(entry, parsed) {
  el.modalActions.textContent = '';
  const addButton = (label, onClick, primary = false) => {
    const button = document.createElement('button');
    button.className = primary ? 'button button-primary' : 'button';
    button.textContent = label;
    button.onclick = onClick;
    el.modalActions.append(button);
    return button;
  };

  // 仕様: URL の場合は「既定ブラウザで開く」か「クリップボードにコピー」を選ばせる
  if (parsed.openUrl) {
    addButton(parsed.openLabel, () => openExternal(parsed.openUrl), true);
  }
  addButton('クリップボードにコピー', () => copyText(entry.text), !parsed.openUrl);

  if (parsed.saveAs) {
    addButton('ファイルに保存…', () => saveContent(entry.text, parsed.saveAs));
  } else {
    addButton('テキストとして保存…', () => saveContent(entry.text, { extension: 'txt', defaultName: 'qr-content.txt' }));
  }

  addButton('履歴から削除', async () => {
    state.history = await window.qr.history.remove(entry.id);
    renderHistory();
    closeModal();
    toast('履歴から削除しました');
  });
  addButton('閉じる', closeModal);
}

function closeModal() {
  el.modal.hidden = true;
  state.modalOpen = false;
  scanner.resume();
}

async function openExternal(url) {
  const result = await window.qr.openUrl(url);
  if (result.ok) {
    toast('既定のアプリで開きました');
    return;
  }
  if (result.reason === 'scheme') {
    toast(`このリンク形式（${result.scheme}）は安全のため開けません`);
  } else {
    toast('リンクとして解釈できませんでした');
  }
}

async function copyText(text) {
  await window.qr.clipboard.write(text);
  toast('クリップボードにコピーしました');
}

async function saveContent(text, { extension, defaultName }) {
  const result = await window.qr.saveText({ text, extension, defaultName });
  if (result.ok) toast('保存しました');
}

/* ------------------------- 履歴 ------------------------- */

function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' });
}

function renderHistory() {
  const keyword = state.filter.trim().toLowerCase();
  const visible = keyword
    ? state.history.filter((entry) =>
        entry.text.toLowerCase().includes(keyword) ||
        (TYPE_LABELS[entry.type] ?? '').toLowerCase().includes(keyword))
    : state.history;

  el.historyCount.textContent = String(state.history.length);
  el.historyList.textContent = '';
  el.historyEmpty.hidden = visible.length > 0;
  el.historyEmpty.textContent = state.history.length === 0
    ? 'まだ読み取り履歴がありません。'
    : '検索条件に一致する履歴はありません。';

  for (const entry of visible) {
    const parsed = parseContent(entry.text);
    const item = document.createElement('li');
    item.className = 'history-item';

    const main = document.createElement('div');
    main.className = 'history-main';

    const meta = document.createElement('div');
    meta.className = 'history-meta';
    const badge = document.createElement('span');
    badge.className = 'type-badge';
    badge.textContent = parsed.label;
    const time = document.createElement('span');
    time.textContent = `${formatTime(entry.createdAt)}・${entry.source === 'image' ? '画像' : 'カメラ'}`;
    meta.append(badge, time);

    const text = document.createElement('div');
    text.className = 'history-text';
    // vCard のように複数行のものは生データではなく要約を見せる
    text.textContent = entry.text.includes('\n') ? parsed.summary : entry.text;
    text.title = entry.text;

    main.append(meta, text);
    main.onclick = () => openModal(entry);

    const actions = document.createElement('div');
    actions.className = 'history-actions';

    if (parsed.openUrl) {
      const open = document.createElement('button');
      open.className = 'button';
      open.textContent = '開く';
      open.onclick = () => openExternal(parsed.openUrl);
      actions.append(open);
    }

    const copy = document.createElement('button');
    copy.className = 'button';
    copy.textContent = 'コピー';
    copy.onclick = () => copyText(entry.text);

    const remove = document.createElement('button');
    remove.className = 'button button-danger';
    remove.textContent = '削除';
    remove.onclick = async () => {
      state.history = await window.qr.history.remove(entry.id);
      renderHistory();
    };

    actions.append(copy, remove);
    item.append(main, actions);
    el.historyList.append(item);
  }
}

/* ------------------------- 画像入力 ------------------------- */

async function decodeAndHandle(dataUrl, label) {
  try {
    const result = await decodeImageFile(dataUrl);
    if (!result) {
      toast(`${label}からQRコードを検出できませんでした`);
      return;
    }
    await handleResult(result.text, 'image');
  } catch (error) {
    toast(`画像を読み込めませんでした: ${error.message}`);
  }
}

async function pickImage() {
  const picked = await window.qr.pickImage();
  if (!picked) return;
  await decodeAndHandle(picked.dataUrl, picked.name);
}

async function pasteImage() {
  const dataUrl = await window.qr.clipboard.image();
  if (!dataUrl) {
    toast('クリップボードに画像がありません');
    return;
  }
  await decodeAndHandle(dataUrl, 'クリップボードの画像');
}

function setupDragAndDrop() {
  window.addEventListener('dragenter', (event) => {
    event.preventDefault();
    state.dragDepth += 1;
    el.dropzone.hidden = false;
  });
  window.addEventListener('dragover', (event) => { event.preventDefault(); });
  window.addEventListener('dragleave', (event) => {
    event.preventDefault();
    state.dragDepth = Math.max(0, state.dragDepth - 1);
    if (state.dragDepth === 0) el.dropzone.hidden = true;
  });
  window.addEventListener('drop', async (event) => {
    event.preventDefault();
    state.dragDepth = 0;
    el.dropzone.hidden = true;

    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    const filePath = window.qr.pathForFile(file);
    const picked = filePath ? await window.qr.readImage(filePath) : null;
    if (picked) {
      await decodeAndHandle(picked.dataUrl, file.name);
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast('画像ファイルをドロップしてください');
      return;
    }
    await decodeAndHandle(await fileToDataUrl(file), file.name);
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('ファイルを読み込めませんでした'));
    reader.readAsDataURL(file);
  });
}

/* ------------------------- 設定の保存 ------------------------- */

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      sound: el.optSound.checked,
      mirror: el.optMirror.checked,
      cameraId: state.cameraId,
    }));
  } catch { /* 保存できなくても動作に影響はない */ }
}

function loadPrefs() {
  try {
    const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    if (typeof prefs.sound === 'boolean') el.optSound.checked = prefs.sound;
    if (typeof prefs.mirror === 'boolean') el.optMirror.checked = prefs.mirror;
    if (typeof prefs.cameraId === 'string') state.cameraId = prefs.cameraId;
  } catch { /* 壊れていれば既定値を使う */ }
  applyMirror();
}

// 画面上のショートカット表記を OS に合わせる
function applyPlatformLabels() {
  document.body.classList.toggle('is-mac', IS_MAC);
  const keys = IS_MAC ? ['⇧', '⌘', 'V'] : ['Ctrl', 'Shift', 'V'];
  const target = $('hint-paste');
  target.textContent = '';
  keys.forEach((key) => {
    const kbd = document.createElement('kbd');
    kbd.textContent = key;
    target.append(kbd);
  });
}

function applyMirror() {
  el.stageInner.classList.toggle('is-mirrored', el.optMirror.checked);
}

/* ------------------------- タブ ------------------------- */

function selectTab(name) {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('is-active', tab.dataset.tab === name);
  });
  document.querySelectorAll('.view').forEach((view) => {
    view.classList.toggle('is-active', view.id === `view-${name}`);
  });
}

/* ------------------------- 初期化 ------------------------- */

function bindEvents() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.onclick = () => selectTab(tab.dataset.tab);
  });

  el.btnToggle.onclick = () => {
    if (scanner.running) {
      scanner.stop();
      showStage({
        title: 'スキャンを停止しました',
        note: '「スキャン開始」でカメラを再開できます。',
      });
    } else {
      startCamera(state.cameraId);
    }
  };

  el.btnImage.onclick = pickImage;
  el.cameraSelect.onchange = () => startCamera(el.cameraSelect.value || null);
  el.optSound.onchange = savePrefs;
  el.optMirror.onchange = () => { applyMirror(); savePrefs(); };

  el.modalClose = $('modal-close');
  el.modalClose.onclick = closeModal;
  $('modal-backdrop').onclick = closeModal;
  $('btn-copy-raw').onclick = () => copyText(el.modalRaw.textContent);

  el.historySearch.oninput = () => { state.filter = el.historySearch.value; renderHistory(); };
  $('btn-export-json').onclick = () => exportHistory('json');
  $('btn-export-csv').onclick = () => exportHistory('csv');
  $('btn-reveal').onclick = () => window.qr.history.reveal();
  $('btn-clear').onclick = async () => {
    if (state.history.length === 0) return;
    if (!window.confirm(`履歴 ${state.history.length} 件をすべて削除します。よろしいですか？`)) return;
    state.history = await window.qr.history.clear();
    renderHistory();
    toast('履歴をすべて削除しました');
  };

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.modalOpen) closeModal();
  });

  navigator.mediaDevices?.addEventListener?.('devicechange', () => { refreshCameraList(); });

  window.qr.onMenu((channel, payload) => {
    if (channel === 'menu:open-image') pickImage();
    else if (channel === 'menu:paste-image') pasteImage();
    else if (channel === 'menu:toggle-scan') el.btnToggle.click();
    else if (channel === 'menu:tab') selectTab(payload);
  });
}

async function exportHistory(format) {
  const result = await window.qr.history.export(format);
  if (result.ok) toast(`エクスポートしました: ${result.path}`);
  else if (result.reason === 'empty') toast('エクスポートする履歴がありません');
}

async function init() {
  applyPlatformLabels();
  loadPrefs();
  bindEvents();
  setupDragAndDrop();

  state.history = await window.qr.history.load();
  renderHistory();
  el.historyPath.textContent = `保存先: ${await window.qr.history.path()}`;

  await startCamera(state.cameraId);
}

init();
