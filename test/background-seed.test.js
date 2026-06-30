const path = require('path');
const { eq, ok, done } = require('./harness');
const { seedProfiles, DEFAULT_PROFILES, PROFILES_VERSION } = require(path.resolve(__dirname, '..', 'seed-data.node.js'));
function fakeStore(initial) {
  const data = Object.assign({}, initial);
  return { data,
    get(keys){ const o={}; (Array.isArray(keys)?keys:[keys]).forEach(k=>{ if(k in data) o[k]=data[k]; }); return Promise.resolve(o); },
    set(obj){ Object.assign(data, obj); return Promise.resolve(); } };
}
(async () => {
  const s1 = fakeStore({}); await seedProfiles(s1);
  eq(s1.data.profiles.length, 4, 'seeds when absent');
  eq(s1.data.profilesVersion, PROFILES_VERSION, 'sets version');
  eq(s1.data.defaultProfile, DEFAULT_PROFILES[0].id, 'sets default when unset');
  const s2 = fakeStore({ profiles:[{id:'mine'}], profilesVersion: PROFILES_VERSION, defaultProfile:'mine' });
  await seedProfiles(s2);
  eq(s2.data.profiles.length, 1, 'no clobber when current');
  eq(s2.data.defaultProfile, 'mine', 'keeps existing default');
  const s3 = fakeStore({ profiles:[{id:'old'}], profilesVersion: 0, defaultProfile:'old' });
  await seedProfiles(s3);
  eq(s3.data.profiles.length, 4, 'reseeds when older');
  done('background-seed');
})();
