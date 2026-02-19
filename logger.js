import https from 'https';
import { URL } from 'url';

const { DISCORD_WEBHOOK_URL } = process.env;

// --- ログ管理用の変数 ---
let logBuffer = [];
let isSending = false;

/**
 * Discord Webhook にバッファ内のログをまとめて送信する
 */
async function processLogQueue() {
  if (isSending || logBuffer.length === 0 || !DISCORD_WEBHOOK_URL) return;

  isSending = true;

  // 最大10行分を取り出し、コードブロック形式でまとめる
  const batch = logBuffer.splice(0, 10);
  const combinedMessage = batch.join('\n');
  const payload = JSON.stringify({
    content: `\`\`\`\n${combinedMessage.substring(0, 1900)}\n\`\`\``,
  });

  const url = new URL(DISCORD_WEBHOOK_URL);
  const options = {
    hostname: url.hostname,
    path: url.pathname + url.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  };

  const req = https.request(options, (res) => {
    // レートリミット(429)に達した場合
    if (res.statusCode === 429) {
      logBuffer.unshift(...batch); // ログをキューの先頭に戻す
      // 5秒待機してから再開
      setTimeout(() => {
        isSending = false;
        processLogQueue();
      }, 5000);
    } else {
      // 成功しても失敗しても、連続送信を避けるため2秒の間隔を空ける
      setTimeout(() => {
        isSending = false;
        processLogQueue();
      }, 2000);
    }
  });

  req.on('error', (err) => {
    // ここで originalError を使わないと無限ループになる可能性があるため、標準出力のみ
    process.stderr.write(`[Internal Logger Error] ${err.message}\n`);
    isSending = false;
    setTimeout(processLogQueue, 5000);
  });

  req.write(payload);
  req.end();
}

// 除外キーワード：これらを含むログは送信しない
const excludeKeywords = [
  'parentId:',
  'TICKET_CAT:',
  'mentions.has(',
  'content:',
  'authorId:',
  'channelId:',
  '（型：',
  'channelName:',
  'createdAt:',
  '[WebhookError]', // Webhookエラー自体をWebhookで送る無限ループを防止
  '429',             // レートリミットエラーの再送防止
];

/**
 * ログをフィルタリングして送信キューに追加
 */
function filterAndSend(rawText) {
  if (!DISCORD_WEBHOOK_URL) return;

  // 無限ループ防止用の除外チェック
  if (excludeKeywords.some(kw => rawText.includes(kw))) {
    return;
  }

  const cleaned = rawText.trim();
  if (cleaned) {
    logBuffer.push(cleaned);
    processLogQueue();
  }
}

// --- 標準入出力のフック ---
const originalLog = console.log;
const originalError = console.error;

console.log = (...args) => {
  const text = args.map(String).join(' ');
  originalLog(...args); // 実際のコンソールに出力
  filterAndSend(text);  // フィルタリングしてWebhookへ
};

console.error = (...args) => {
  const raw = args.map(arg => {
    if (arg instanceof Error) return arg.stack || arg.message;
    if (typeof arg === 'object') {
      try { return JSON.stringify(arg, null, 2); }
      catch { return String(arg); }
    }
    return String(arg);
  }).join('\n');

  originalError(...args); // 実際のコンソールに出力
  filterAndSend(raw);     // フィルタリングしてWebhookへ
};

/**
 * メッセージデバッグログ関数（originalLogを使用することでWebhook送信を回避）
 */
export function messagelog(m, TICKET_CAT, bot) {
  originalLog('parentId:', m.channel?.parentId, '（型：', typeof m.channel?.parentId, '）');
  originalLog('TICKET_CAT:', TICKET_CAT, '（型：', typeof TICKET_CAT, '）');
  originalLog('mentions.has(bot.user):', m.mentions?.has(bot.user));
  originalLog('authorId:', m.author?.id);
  originalLog('channelId:', m.channel?.id, 'channelName:', m.channel?.name);
  originalLog('createdAt:', m.createdAt?.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }));
  originalLog('content:', m.content);
}

export const logger = {
  messagelog
};

export default logger;
