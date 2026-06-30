// seed-data.node.js — CommonJS source of truth for seed logic (requireable by tests).
// background.js mirrors this inline (module worker can't load the classic global).
const PROFILES_VERSION = 1;
const _all = { name:true, contact:true, address:true, account:true, misc:true };
const DEFAULT_PROFILES = [
  { id:'au-personal', label:'AU Personal', country:'AU', randomize:true,
    policy:{ groups:Object.assign({}, _all, { misc:false }), exclude:[] }, pins:{} },
  { id:'au-business', label:'AU Business / Company', country:'AU', randomize:true,
    policy:{ groups:Object.assign({}, _all), exclude:[] }, pins:{ business:'Aether Dynamics Pty Ltd' } },
  { id:'us-test', label:'US Test User', country:'US', randomize:true,
    policy:{ groups:Object.assign({}, _all, { misc:false }), exclude:[] }, pins:{} },
  { id:'minimal', label:'Minimal / Edge Case', country:'AU', randomize:true,
    policy:{ groups:{ name:true, contact:false, address:false, account:false, misc:false }, exclude:[] }, pins:{} }
];
async function seedProfiles(store) {
  const cur = await store.get(['profiles', 'profilesVersion', 'defaultProfile']);
  const needsSeed = !cur.profiles || (cur.profilesVersion || 0) < PROFILES_VERSION;
  const patch = {};
  if (needsSeed) { patch.profiles = JSON.parse(JSON.stringify(DEFAULT_PROFILES)); patch.profilesVersion = PROFILES_VERSION; }
  if (!cur.defaultProfile) patch.defaultProfile = DEFAULT_PROFILES[0].id;
  if (Object.keys(patch).length) await store.set(patch);
}
module.exports = { PROFILES_VERSION, DEFAULT_PROFILES, seedProfiles };
