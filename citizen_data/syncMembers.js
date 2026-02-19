import { upsertMember } from './czrApi.js';

const GUILD_ID      = '1188411576483590194';
const ROLE_DIPLOMAT = '1188429176739479562';

export function inferGroupFromRoles(roleIds) {
  if (roleIds.includes(ROLE_DIPLOMAT)) return 'diplomat';
  return 'citizen';
}

export async function syncMember(m) {
  const roles = [...m.roles.cache.keys()];
  
  const payload = {
    guild_id: GUILD_ID,
    discord_id: m.id,
    // --- プラグイン側の仕様（$p['discord_name']）に合わせて統合 ---
    discord_name: m.user.username,       // WPユーザー名と照合するためのキー
    display_name: m.displayName,         // サーバー内表示名（参考用）
    // -------------------------------------------------------
    group: inferGroupFromRoles(roles),
    roles,
  };

  const res = await upsertMember(payload);
  console.log('[syncMember]', `${m.id}`, res.status);
  return res;
}

export async function fullSync(client, throttleMs = 1000) {
  const g = await client.guilds.fetch(GUILD_ID);
  
  // 最新のコードに合わせて fetch() を使用し、全メンバーを取得
  const members = await g.members.fetch({ limit: 1000 }); 
  
  console.log(`[fullSync] Start syncing ${members.size} members...`);

  for (const m of members.values()) {
    // BOTを除外（必要に応じて）
    if (m.user.bot) continue;

    try {
      await syncMember(m);
    } catch (e) {
      console.error('[fullSync] member', m.id, 'failed:', e.message);
    }
    
    // 指定された 1000ms + ランダムな揺らぎで待機
    const jitter = Math.floor(Math.random() * 250);
    await new Promise(r => setTimeout(r, throttleMs + jitter));
  }
  console.log('[fullSync] Completed.');
}
