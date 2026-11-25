// 麻醉科忘年會投票系統 — 共用程式（Firebase 模式 / Demo 模式）
// 不需要修改這個檔案。

export const IS_DEMO = !window.FIREBASE_CONFIG;

function makeDeviceId(){
  try{
    let d = localStorage.getItem('ane_vote_device');
    if(!d){ d = Math.random().toString(36).slice(2,10) + Date.now().toString(36); localStorage.setItem('ane_vote_device', d); }
    return d;
  }catch(e){ return 'x' + Math.random().toString(36).slice(2,12); }
}
export const DEVICE = makeDeviceId();

export function tally(list, round){
  const c=[0,0,0,0];
  for(const x of list){ if(x && x.round===round && x.choice>=1 && x.choice<=4) c[x.choice-1]++; }
  return c;
}

export async function connect(){
  return IS_DEMO ? demoBackend() : firebaseBackend(window.FIREBASE_CONFIG);
}

/* ---------------- Demo 模式（同一台電腦的分頁之間） ---------------- */
function demoBackend(){
  const ch = ('BroadcastChannel' in window) ? new BroadcastChannel('ane-vote-demo') : null;
  const get=(k,d)=>{ try{ const v=JSON.parse(localStorage.getItem(k)); return v==null?d:v; }catch(e){ return d; } };
  const set=(k,v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} };
  const stateCbs=[], voteCbs=[];
  function fire(){
    const st=get('ane_demo_state',{status:'idle'});
    stateCbs.forEach(f=>f(st));
    const all=Object.values(get('ane_demo_votes',{}));
    voteCbs.forEach(e=>e.cb(tally(all,e.round)));
  }
  function changed(){ if(ch) ch.postMessage(1); fire(); }
  if(ch) ch.onmessage=fire;
  window.addEventListener('storage', fire);
  return {
    mode:'demo',
    onState(cb){ stateCbs.push(cb); cb(get('ane_demo_state',{status:'idle'})); return ()=>{}; },
    async setState(patch){ set('ane_demo_state', {...get('ane_demo_state',{}), ...patch}); changed(); },
    async vote(round, choice, dev=DEVICE){
      const st=get('ane_demo_state',{});
      if(st.status!=='open' || st.round!==round) throw new Error('投票已結束');
      const v=get('ane_demo_votes',{}); v[round+'_'+dev]={round,choice}; set('ane_demo_votes',v); changed();
    },
    onVotes(round, cb){
      const e={round,cb}; voteCbs.push(e);
      cb(tally(Object.values(get('ane_demo_votes',{})), round));
      return ()=>{ const i=voteCbs.indexOf(e); if(i>=0) voteCbs.splice(i,1); };
    },
    async addBots(round, n, weights=[.4,.3,.2,.1]){
      const v=get('ane_demo_votes',{}), base=Object.keys(v).length;
      for(let i=0;i<n;i++){
        let r=Math.random(), c=4;
        for(let j=0;j<4;j++){ if(r<weights[j]){ c=j+1; break; } r-=weights[j]; }
        v[round+'_bot'+(base+i)]={round,choice:c};
      }
      set('ane_demo_votes',v); changed();
    },
    async signIn(){}, onAuth(cb){ cb({email:'demo'}); }, isHost(){ return true; },
  };
}

/* ---------------- Firebase 模式（正式上場） ---------------- */
async function firebaseBackend(cfg){
  const V='10.12.2', base=`https://www.gstatic.com/firebasejs/${V}/`;
  const [AppM, F, A] = await Promise.all([
    import(base+'firebase-app.js'), import(base+'firebase-firestore.js'), import(base+'firebase-auth.js')
  ]);
  const app = AppM.initializeApp(cfg);
  const db = F.getFirestore(app);
  const auth = A.getAuth(app);
  const stateRef = F.doc(db,'game','state');
  const authCbs=[]; let user=null;
  A.onAuthStateChanged(auth, u=>{ user=u; authCbs.forEach(f=>f(u)); });
  const hostEmail = (window.HOST_EMAIL||'').trim().toLowerCase();
  return {
    mode:'firebase',
    onState(cb, onErr){
      return F.onSnapshot(stateRef, s=>cb(s.exists()? s.data() : {status:'idle'}), e=>{ console.error(e); onErr && onErr(e); });
    },
    setState(patch){ return F.setDoc(stateRef, patch, {merge:true}); },
    vote(round, choice){
      return F.setDoc(F.doc(db,'votes',`${round}_${DEVICE}`), {round, choice, t:F.serverTimestamp()});
    },
    onVotes(round, cb){
      const q = F.query(F.collection(db,'votes'), F.where('round','==',round));
      return F.onSnapshot(q, snap=>{ const list=[]; snap.forEach(d=>list.push(d.data())); cb(tally(list,round)); }, e=>console.error(e));
    },
    async signIn(){ await A.signInWithPopup(auth, new A.GoogleAuthProvider()); },
    async signOut(){ await A.signOut(auth); },
    onAuth(cb){ authCbs.push(cb); cb(user); },
    isHost(){ return !!user && (!hostEmail || (user.email||'').toLowerCase()===hostEmail); },
  };
}
