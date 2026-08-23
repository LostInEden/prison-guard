// Shared world storage: a Supabase project with a `worlds` table reached only through SQL functions that check a
// room code (see README "Sharing worlds"). The anon key below is public by design; the room code is what gates access.
export const CLOUD = {
  url: 'https://sguggdihkhcimvqnmirk.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNndWdnZGloa2hjaW12cW5taXJrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0OTcwNTMsImV4cCI6MjEwMzA3MzA1M30.dwByE3x8hDUWFea_GJrFbDUbXzeNAQPnPUU2EZvOvUg',
};

async function rpc(name, args) {
  const r = await fetch(`${CLOUD.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: CLOUD.anonKey, Authorization: `Bearer ${CLOUD.anonKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await r.text();
  if (!r.ok) { let msg = text; try { msg = JSON.parse(text).message || text; } catch {} throw new Error(msg); }
  return text ? JSON.parse(text) : null;
}

// latest version of every world: [{ id, name, author, created_at, versions }]
export const listWorlds = (code) => rpc('list_worlds', { code });
// all saved versions of one world, newest first: [{ id, author, created_at }]
export const worldVersions = (code, name) => rpc('world_versions', { code, world_name: name });
// the world JSON for a version id
export const loadWorld = (code, id) => rpc('load_world', { code, world_id: id });
// saves a new version; returns its id. Throws 'bad room code' if the code is wrong.
export const saveWorld = (code, name, author, data) => rpc('save_world', { code, world_name: name, world_author: author, world_data: data });
// true if the room code is accepted
export const checkRoom = (code) => rpc('room_ok', { code });

export function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
