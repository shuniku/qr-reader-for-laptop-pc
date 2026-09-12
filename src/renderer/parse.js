// 読み取った文字列の種別を判定し、UI が使いやすい形に整形する。

const BARE_DOMAIN = /^(?:www\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?::\d{1,5})?(?:[/?#]\S*)?$/i;

// WIFI: / MECARD: 形式では \; \: \, \\ がエスケープされている
function unescapeValue(value) {
  return value.replace(/\\(.)/g, '$1');
}

// エスケープされていない区切り文字だけで分割する
function splitUnescaped(input, separator) {
  const parts = [];
  let current = '';
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === '\\' && i + 1 < input.length) {
      current += char + input[i + 1];
      i += 1;
    } else if (char === separator) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

function parseKeyValueBody(body) {
  const result = {};
  for (const chunk of splitUnescaped(body, ';')) {
    if (!chunk) continue;
    const index = chunk.indexOf(':');
    if (index === -1) continue;
    const key = chunk.slice(0, index).trim().toUpperCase();
    if (key) result[key] = unescapeValue(chunk.slice(index + 1));
  }
  return result;
}

function parseWifi(text) {
  const raw = parseKeyValueBody(text.slice('WIFI:'.length));
  const security = (raw.T || 'nopass').toUpperCase();
  return {
    fields: [
      { label: 'SSID（ネットワーク名）', value: raw.S || '', copyable: true },
      { label: '暗号化方式', value: security === 'NOPASS' ? 'なし（オープン）' : security },
      { label: 'パスワード', value: raw.P || '', copyable: true, secret: true },
      ...(raw.H === 'true' ? [{ label: 'ステルスSSID', value: 'はい' }] : []),
    ].filter((field) => field.value !== ''),
    summary: raw.S ? `Wi-Fi: ${raw.S}` : 'Wi-Fi設定',
  };
}

function parseMecard(text) {
  const raw = parseKeyValueBody(text.slice('MECARD:'.length));
  const name = (raw.N || '').split(',').map((s) => s.trim()).filter(Boolean).reverse().join(' ');
  return {
    fields: [
      { label: '名前', value: name, copyable: true },
      { label: '電話番号', value: raw.TEL || '', copyable: true, action: raw.TEL ? `tel:${raw.TEL}` : null },
      { label: 'メール', value: raw.EMAIL || '', copyable: true, action: raw.EMAIL ? `mailto:${raw.EMAIL}` : null },
      { label: '住所', value: raw.ADR || '', copyable: true },
      { label: 'メモ', value: raw.NOTE || '', copyable: true },
    ].filter((field) => field.value !== ''),
    summary: name ? `連絡先: ${name}` : '連絡先',
  };
}

function unfoldVcard(text) {
  // vCard は行頭のスペース／タブで折り返し継続を表す
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

function parseVcard(text) {
  const picked = {};
  for (const line of unfoldVcard(text).split('\n')) {
    const index = line.indexOf(':');
    if (index === -1) continue;
    const name = line.slice(0, index).split(';')[0].trim().toUpperCase();
    const value = line.slice(index + 1).trim();
    if (!value || name in picked) continue;
    picked[name] = value;
  }
  const name = (picked.FN || picked.N || '').split(';').filter(Boolean).join(' ').trim();
  return {
    fields: [
      { label: '名前', value: name, copyable: true },
      { label: '組織', value: picked.ORG ? picked.ORG.replace(/;/g, ' ') : '', copyable: true },
      { label: '肩書', value: picked.TITLE || '' },
      { label: '電話番号', value: picked.TEL || '', copyable: true, action: picked.TEL ? `tel:${picked.TEL}` : null },
      { label: 'メール', value: picked.EMAIL || '', copyable: true, action: picked.EMAIL ? `mailto:${picked.EMAIL}` : null },
      { label: 'URL', value: picked.URL || '', copyable: true, action: picked.URL || null },
      { label: '住所', value: picked.ADR ? picked.ADR.replace(/;+/g, ' ').trim() : '', copyable: true },
    ].filter((field) => field.value !== ''),
    summary: name ? `連絡先: ${name}` : '連絡先（vCard）',
  };
}

function parseMailto(text) {
  const url = new URL(text);
  const params = url.searchParams;
  return {
    fields: [
      { label: '宛先', value: decodeURIComponent(url.pathname), copyable: true },
      { label: '件名', value: params.get('subject') || '' },
      { label: '本文', value: params.get('body') || '' },
    ].filter((field) => field.value !== ''),
    summary: `メール: ${decodeURIComponent(url.pathname)}`,
  };
}

/**
 * @param {string} text QRコードから読み取った生の文字列
 * @returns {{type, label, summary, fields, openUrl, openLabel, isUrl, needsScheme, saveAs}}
 */
export function parseContent(text) {
  const value = String(text ?? '');
  const trimmed = value.trim();
  const base = { text: value, fields: [], openUrl: null, openLabel: null, isUrl: false, needsScheme: false, saveAs: null };

  if (/^https?:\/\//i.test(trimmed)) {
    let host = trimmed;
    try { host = new URL(trimmed).host; } catch { /* パースできなければ全文を見出しに使う */ }
    return { ...base, type: 'url', label: 'URL', summary: host, openUrl: trimmed, openLabel: 'ブラウザで開く', isUrl: true };
  }

  if (/^mailto:/i.test(trimmed)) {
    let parsed = { fields: [], summary: trimmed };
    try { parsed = parseMailto(trimmed); } catch { /* 不正な mailto はそのまま表示する */ }
    return { ...base, type: 'email', label: 'メールアドレス', ...parsed, openUrl: trimmed, openLabel: 'メールアプリで開く' };
  }

  if (/^(tel|sms|smsto):/i.test(trimmed)) {
    const isTel = /^tel:/i.test(trimmed);
    const number = trimmed.replace(/^(tel|sms|smsto):/i, '').split(/[:?]/)[0];
    return {
      ...base,
      type: isTel ? 'tel' : 'sms',
      label: isTel ? '電話番号' : 'SMS',
      summary: number,
      fields: [{ label: isTel ? '電話番号' : '送信先', value: number, copyable: true }],
      openUrl: trimmed,
      openLabel: isTel ? '電話アプリで開く' : 'メッセージアプリで開く',
    };
  }

  if (/^geo:/i.test(trimmed)) {
    const [lat, lon] = trimmed.slice(4).split('?')[0].split(',');
    const mapUrl = lat && lon ? `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lon}`)}` : null;
    return {
      ...base,
      type: 'geo',
      label: '位置情報',
      summary: `${lat ?? ''}, ${lon ?? ''}`,
      fields: [{ label: '緯度', value: lat ?? '' }, { label: '経度', value: lon ?? '' }].filter((f) => f.value),
      openUrl: mapUrl,
      openLabel: '地図をブラウザで開く',
      isUrl: Boolean(mapUrl),
    };
  }

  if (/^WIFI:/i.test(trimmed)) {
    return { ...base, type: 'wifi', label: 'Wi-Fi設定', ...parseWifi(trimmed) };
  }

  if (/^MECARD:/i.test(trimmed)) {
    return { ...base, type: 'contact', label: '連絡先（MeCard）', ...parseMecard(trimmed) };
  }

  if (/^BEGIN:VCARD/i.test(trimmed)) {
    return {
      ...base,
      type: 'contact',
      label: '連絡先（vCard）',
      ...parseVcard(trimmed),
      saveAs: { extension: 'vcf', defaultName: 'contact.vcf' },
    };
  }

  if (/^BEGIN:(VEVENT|VCALENDAR)/i.test(trimmed)) {
    return {
      ...base,
      type: 'event',
      label: 'カレンダー予定',
      summary: (/SUMMARY:(.+)/i.exec(trimmed)?.[1] || '予定').trim(),
      saveAs: { extension: 'ics', defaultName: 'event.ics' },
    };
  }

  // スキームのない裸のドメイン（例: example.com/path）は URL 候補として扱う
  if (!trimmed.includes(' ') && trimmed.length <= 2048 && BARE_DOMAIN.test(trimmed)) {
    return {
      ...base,
      type: 'url',
      label: 'URL（スキームなし）',
      summary: trimmed,
      openUrl: `https://${trimmed}`,
      openLabel: 'ブラウザで開く',
      isUrl: true,
      needsScheme: true,
    };
  }

  return { ...base, type: 'text', label: 'テキスト', summary: trimmed.slice(0, 80) || '(空)' };
}

export const TYPE_LABELS = {
  url: 'URL', email: 'メール', tel: '電話', sms: 'SMS', geo: '位置情報',
  wifi: 'Wi-Fi', contact: '連絡先', event: '予定', text: 'テキスト',
};
