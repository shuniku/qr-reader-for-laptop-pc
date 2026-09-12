'use strict';
// 読み取り履歴をユーザーデータ領域の JSON ファイルに保存する簡易ストア。
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const MAX_ENTRIES = 1000;

function filePath() {
  return path.join(app.getPath('userData'), 'history.json');
}

function load() {
  try {
    const raw = fs.readFileSync(filePath(), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('履歴の読み込みに失敗しました:', err);
    return [];
  }
}

function save(entries) {
  const file = filePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // 書き込み途中での破損を避けるため一時ファイル経由で置き換える
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function add(entry) {
  const entries = load();
  const record = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text: String(entry.text ?? ''),
    type: String(entry.type ?? 'text'),
    source: entry.source === 'image' ? 'image' : 'camera',
    createdAt: new Date().toISOString(),
  };
  entries.unshift(record);
  save(entries.slice(0, MAX_ENTRIES));
  return record;
}

function remove(id) {
  const entries = load().filter((e) => e.id !== id);
  save(entries);
  return entries;
}

function clear() {
  save([]);
  return [];
}

function toCsv(entries) {
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const head = ['id', 'createdAt', 'type', 'source', 'text'];
  const rows = entries.map((e) => head.map((k) => esc(e[k] ?? '')).join(','));
  // Excel での文字化けを防ぐため BOM を付ける
  return '﻿' + [head.join(','), ...rows].join('\r\n') + '\r\n';
}

module.exports = { filePath, load, add, remove, clear, toCsv };
