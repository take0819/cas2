// commands/shutdown.js
import { SlashCommandBuilder } from 'discord.js';
import axios from 'axios';

export const data = new SlashCommandBuilder()
  .setName('shutdown')
  .setDescription('ボットを停止します');

export async function execute(interaction) {
  // ── 許可ロールIDの取得 ──
  const allowedRoleIds = (process.env.STOP_ROLE_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  // ── 実行者のロールID取得（ギルド or DM） ──
  let executorRoleIds = [];
  if (interaction.guildId) {
    // ギルド内：通常の member.roles.cache から取得
    executorRoleIds = interaction.member.roles.cache.map(r => r.id);
  } else {
    // DM：REFERENCE_GUILD_ID からメンバーをフェッチして取得
    const refGuildId = "1188411576483590194";
    if (!refGuildId) {
      throw new Error("環境変数 REFERENCE_GUILD_ID が設定されていません");
    }
    const guild = await interaction.client.guilds.fetch(refGuildId);
    const member = await guild.members.fetch(interaction.user.id);
    executorRoleIds = member.roles.cache.map(r => r.id);
  }

  // ── 権限チェック ──
  const isAllowed = allowedRoleIds.some(rid => executorRoleIds.includes(rid));
  if (!isAllowed) {
    return interaction.reply({
      content: '⚠️ このコマンドを実行する権限がありません。',
      ephemeral: !!interaction.guildId,  // ギルド内はエフェメラル、DMは通常
    });
  }

  // ── ACK／応答 ──
  await interaction.deferReply({ ephemeral: true });
  await interaction.editReply({ content: '⏱ ボットをサスペンド中です…' });

  // ── サスペンド（Pause）処理 ──
  setTimeout(async () => {
    try {
      // 1) Discordクライアント停止
      interaction.client.destroy();

      // 2) Koyeb 上で「Pause」実行 → 自動再起動を抑制
      const apiToken = process.env.KOYEB_API_TOKEN;
      const appId    = process.env.KOYEB_APP_ID;
      if (apiToken && appId) {
        await axios.post(
          `https://api.koyeb.com/v1/apps/${appId}/actions/pause`,
          {},
          { headers: { Authorization: `Bearer ${apiToken}` } }
        );
        console.log('[shutdown] Koyeb Pause API 呼び出し完了');
      } else {
        console.warn('[shutdown] KOYEB_API_TOKEN または KOYEB_APP_ID が未設定です。');
      }
    } catch (error) {
      console.error('🔴 サスペンド処理中にエラーが発生しました:', error);
    } finally {
      // 3) プロセス終了
      process.exit(0);
    }
  }, 1000);
}
