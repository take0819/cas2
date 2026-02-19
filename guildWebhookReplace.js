// guildWebhookReplace.js
import axios from 'axios';

/**
 * ギルド内の webhook を一括差し替えするユーティリティ
 *
 * @param {Client} client - Discord Client（interaction.client 等）
 * @param {string} guildId - 差し替え対象のギルドID
 * @param {string|Buffer} imageSource - 新しいアイコン。公開 URL (https://...) か、既に Buffer の場合はそのまま渡す
 * @param {object} options - オプション
 *   - matchNames: string[] | null  // webhook.name がこの配列に含まれるものだけ差し替える。null で全て
 *   - matchRegex: RegExp | null    // 名前フィルタを正規表現で行いたい場合
 *   - concurrencyDelayMs: number   // 個々の edit の間に待つミリ秒（rate limit 回避、デフォルト 600）
 *   - dryRun: boolean              // true のとき変更は行わず、対象をログに出すだけ
 *
 * 返り値: { updated: [], failed: [], skipped: [] }
 */
export async function replaceGuildWebhooksAvatar(client, guildId, imageSource, options = {}) {
  const {
    matchNames = null,
    matchRegex = null,
    concurrencyDelayMs = 600,
    dryRun = false,
  } = options;

  // 1) 画像を Buffer に変換（imageSource が URL の場合）
  let avatarBuffer = null;
  if (Buffer.isBuffer(imageSource)) {
    avatarBuffer = imageSource;
  } else if (typeof imageSource === 'string') {
    // treat as URL
    try {
      const res = await axios.get(imageSource, { responseType: 'arraybuffer', timeout: 15000 });
      avatarBuffer = Buffer.from(res.data);
    } catch (err) {
      throw new Error('アイコン画像のダウンロードに失敗しました: ' + err.message);
    }
  } else {
    throw new Error('imageSource は URL 文字列か Buffer を渡してください');
  }

  // 2) ギルド取得
  const guild = await client.guilds.fetch(guildId);
  if (!guild) throw new Error('指定された guild が見つかりません: ' + guildId);

  // 3) チャンネルを fetch してキャッシュを埋める（channels.cache を使うため）
  try {
    await guild.channels.fetch();
  } catch (err) {
    // fetch が失敗しても cache にある分で処理する
    console.warn('[replaceGuildWebhooksAvatar] guild.channels.fetch() failed, continuing with cache:', err.message);
  }

  const updated = [];
  const failed = [];
  const skipped = [];

  // ヘルパー
  const sleep = ms => new Promise(res => setTimeout(res, ms));

  // 4) 各チャンネルを順に処理
  for (const channel of guild.channels.cache.values()) {
    // テキスト系でないチャンネルはスキップ（thread も isTextBased() で true になる）
    if (!channel?.isTextBased?.() ) continue;

    let hooks;
    try {
      hooks = await channel.fetchWebhooks();
    } catch (err) {
      console.warn(`[replaceGuildWebhooksAvatar] fetchWebhooks failed for channel ${channel.id}: ${err.message}`);
      continue;
    }

    for (const hook of hooks.values()) {
      // フィルタ判定
      if (matchNames && !matchNames.includes(hook.name)) {
        skipped.push({ channelId: channel.id, webhookId: hook.id, reason: 'name not in matchNames', name: hook.name });
        continue;
      }
      if (matchRegex && !matchRegex.test(hook.name)) {
        skipped.push({ channelId: channel.id, webhookId: hook.id, reason: 'name regex not match', name: hook.name });
        continue;
      }

      // dryRun の場合は実行せずログだけ
      if (dryRun) {
        console.log('[dryRun] would update webhook:', { channelId: channel.id, webhookId: hook.id, name: hook.name });
        updated.push({ channelId: channel.id, webhookId: hook.id, name: hook.name, dryRun: true });
        continue;
      }

      // 実行
      try {
        // hook.edit に Buffer を渡すとアイコンが差し替わる
        const edited = await hook.edit({
          avatar: avatarBuffer,
          reason: `Bulk avatar update by bot for guild ${guildId}`,
        });
        console.log('[replaceGuildWebhooksAvatar] updated:', edited.id, 'name:', edited.name, 'channel:', channel.id);
        updated.push({ channelId: channel.id, webhookId: edited.id, name: edited.name });
      } catch (err) {
        console.error('[replaceGuildWebhooksAvatar] failed to edit webhook:', hook.id, err);
        failed.push({ channelId: channel.id, webhookId: hook.id, name: hook.name, error: err.message });
      }

      // rate limit 回避のため短い待ち（順次処理）
      await sleep(concurrencyDelayMs);
    }
  }

  return { updated, failed, skipped };
}
