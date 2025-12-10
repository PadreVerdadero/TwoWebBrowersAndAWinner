/**
 * Full client script
 * - Firebase Auth (Google + Anonymous)
 * - Realtime Database usage with databaseURL
 * - Callable Cloud Functions: seedRoles, tallyVotes, requestExchange (assumed deployed)
 * - Per-player inboxes, private reveals, votes, leader selection, hostage marking, DB-authoritative round state
 *
 * NOTE: Update firebaseConfig.databaseURL to match your project if different.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import {
  getDatabase, ref, set, push, onValue, update, remove, get, child
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-database.js";
import {
  getAuth, signInAnonymously, signInWithPopup, GoogleAuthProvider,
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-functions.js";

/* ---------------------------
   Firebase config
   --------------------------- */
const firebaseConfig = {
  apiKey: "AIzaSyB7fXtog_41paX_ucqFadY4_qaDkBOFdP8",
  authDomain: "twowebbrowsers.firebaseapp.com",
  projectId: "twowebbrowsers",
  storageBucket: "twowebbrowsers.firebasestorage.app",
  messagingSenderId: "187940323050",
  appId: "1:187940323050:web:be4be5d2dd748664692193",
  databaseURL: "https://twowebbrowsers-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);
const functions = getFunctions(app);

/* ---------------------------
   DOM refs
   --------------------------- */
const signInGoogleBtn = document.getElementById("signInGoogleBtn");
const signInAnonBtn = document.getElementById("signInAnonBtn");
const userInfo = document.getElementById("userInfo");
const userLabel = document.getElementById("userLabel");
const signOutBtn = document.getElementById("signOutBtn");

const joinBtn = document.getElementById("joinBtn");
const leaveBtn = document.getElementById("leaveBtn");
const playerNameInput = document.getElementById("playerNameInput");

const playersA = document.getElementById("playersA");
const playersB = document.getElementById("playersB");
const leaderA = document.getElementById("leaderA");
const leaderB = document.getElementById("leaderB");
const hostageA = document.getElementById("hostageA");
const hostageB = document.getElementById("hostageB");

const messagesEl = document.getElementById("messages");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");

const seedRolesBtn = document.getElementById("seedRolesBtn");
const tallyVotesBtn = document.getElementById("tallyVotesBtn");
const startRoundBtn = document.getElementById("startRoundBtn");
const stopRoundBtn = document.getElementById("stopRoundBtn");
const exchangeBtn = document.getElementById("exchangeBtn");

const timerEl = document.getElementById("timer");
const phaseEl = document.getElementById("phase");
const roundHostEl = document.getElementById("roundHost");

const actionMenu = document.getElementById("actionMenu");
const actionMenuTitle = document.getElementById("actionMenuTitle");
const menuVote = document.getElementById("menuVote");
const menuPrivateMsg = document.getElementById("menuPrivateMsg");
const menuRevealColor = document.getElementById("menuRevealColor");
const menuRevealRole = document.getElementById("menuRevealRole");
const menuMarkHostage = document.getElementById("menuMarkHostage");
const menuClose = document.getElementById("menuClose");

const modalOverlay = document.getElementById("modalOverlay");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");
const modalCancel = document.getElementById("modalCancel");
const modalConfirm = document.getElementById("modalConfirm");

/* ---------------------------
   Local state
   --------------------------- */
let currentUser = null;         // firebase user object
let uid = null;                 // auth uid
let displayName = null;         // chosen display name
let currentRoom = "roomA";      // client-side room (leader and moves use DB)
let privateRevealsForMe = {};   // cached reveals given to me
let actionTarget = null;        // { name, uid, roomId } for action menu
let roundLocalInterval = null;  // if this client is authoritative writer (optional)
let isJoined = false;

/* ---------------------------
   Auth handlers
   --------------------------- */
signInGoogleBtn.onclick = async () => {
  const provider = new GoogleAuthProvider();
  try { await signInWithPopup(auth, provider); } catch (e) { alert(e.message); }
};
signInAnonBtn.onclick = async () => {
  try { await signInAnonymously(auth); } catch (e) { alert(e.message); }
};
signOutBtn.onclick = async () => { await signOut(auth); location.reload(); };

onAuthStateChanged(auth, user => {
  currentUser = user;
  if (user) {
    uid = user.uid;
    userInfo.style.display = "inline-block";
    userLabel.textContent = user.displayName ? `${user.displayName} (${uid.slice(0,6)})` : `You (${uid.slice(0,6)})`;
    signInGoogleBtn.style.display = "none";
    signInAnonBtn.style.display = "none";
  } else {
    uid = null;
    userInfo.style.display = "none";
    signInGoogleBtn.style.display = "inline-block";
    signInAnonBtn.style.display = "inline-block";
  }
});

/* ---------------------------
   Join / Leave
   --------------------------- */
joinBtn.onclick = async () => {
  if (!uid) { alert("Sign in first"); return; }
  displayName = (playerNameInput.value || "").trim() || `Player-${uid.slice(0,6)}`;
  // write playersMeta and room player node (ownership enforced by DB rules)
  await set(ref(db, `playersMeta/${uid}`), { displayName, joinedAt: Date.now() });
  await set(ref(db, `matches/default/rooms/${currentRoom}/players/${uid}`), { displayName, rolePublic: "Unknown", revealedPublic: false });
  isJoined = true;
  joinBtn.style.display = "none";
  leaveBtn.style.display = "inline-block";
  playerNameInput.disabled = true;

  // attach listeners
  renderRoom("roomA", playersA, "roomA");
  renderRoom("roomB", playersB, "roomB");
  renderLeaderLabels();
  attachInboxListener(uid);
  attachPrivateRevealsListener(uid);
  attachRoundListener();
};

leaveBtn.onclick = async () => {
  if (!isJoined) return;
  await remove(ref(db, `matches/default/rooms/${currentRoom}/players/${uid}`));
  await remove(ref(db, `playersMeta/${uid}`));
  isJoined = false;
  joinBtn.style.display = "inline-block";
  leaveBtn.style.display = "none";
  playerNameInput.disabled = false;
  messagesEl.innerHTML = "";
};

/* ---------------------------
   Room rendering and actions
   - players stored at matches/default/rooms/{roomId}/players/{uid}
   - leader stored at matches/default/rooms/{roomId}/leaderUid
   - hostage target stored at matches/default/rooms/{roomId}/hostageTargetUid
   --------------------------- */
function renderRoom(roomId, containerEl, roomKey) {
  const playersRef = ref(db, `matches/default/rooms/${roomId}/players`);
  const leaderRef = ref(db, `matches/default/rooms/${roomId}/leaderUid`);
  const hostageRef = ref(db, `matches/default/rooms/${roomId}/hostageTargetUid`);

  onValue(playersRef, async snap => {
    const players = snap.val() || {};
    containerEl.innerHTML = "";
    // fetch leader and hostage once for styling
    const leaderSnap = await get(leaderRef);
    const leaderUid = leaderSnap.exists() ? leaderSnap.val() : null;
    const hostageSnap = await get(hostageRef);
    const hostageUid = hostageSnap.exists() ? hostageSnap.val() : null;

    // update labels
    if (roomId === "roomA") { leaderA.textContent = `Leader: ${leaderUid ? leaderUid.slice(0,6) : "(none)"}`; hostageA.textContent = `Hostage: ${hostageUid ? hostageUid.slice(0,6) : "(none)"}`; }
    else { leaderB.textContent = `Leader: ${leaderUid ? leaderUid.slice(0,6) : "(none)"}`; hostageB.textContent = `Hostage: ${hostageUid ? hostageUid.slice(0,6) : "(none)"}`; }

    for (const pUid of Object.keys(players)) {
      const info = players[pUid];
      const div = document.createElement("div");
      div.className = "player";
      // show private reveal if I have one for this player
      const reveal = privateRevealsForMe[pUid];
      let label = info.displayName || pUid.slice(0,6);
      if (reveal && reveal.role) {
        const r = reveal.role;
        if (r === "Red") { div.classList.add("red"); label += " 🔴"; }
        else if (r === "Blue") { div.classList.add("blue"); label += " 🔵"; }
        else if (r === "President") label += " 👑";
        else if (r === "Bomber") label += " 💣";
      }
      if (leaderUid === pUid) div.classList.add("leader");
      div.textContent = label;
      div.onclick = (e) => {
        e.stopPropagation();
        showActionMenu(pUid, info.displayName || pUid.slice(0,6), e.clientX, e.clientY, roomId);
      };
      containerEl.appendChild(div);
    }
  });
}

/* ---------------------------
   Leader labels (kept in renderRoom but also listen globally)
   --------------------------- */
function renderLeaderLabels() {
  onValue(ref(db, `matches/default/rooms/roomA/leaderUid`), snap => {
    const v = snap.val(); leaderA.textContent = `Leader: ${v || "(none)"}`;
  });
  onValue(ref(db, `matches/default/rooms/roomB/leaderUid`), snap => {
    const v = snap.val(); leaderB.textContent = `Leader: ${v || "(none)"}`;
  });
}

/* ---------------------------
   Action menu (contextual)
   --------------------------- */
function showActionMenu(targetUid, targetName, x, y, roomId) {
  actionTarget = { uid: targetUid, name: targetName, roomId };
  actionMenuTitle.textContent = `Actions for ${targetName}`;
  actionMenu.style.left = `${x}px`;
  actionMenu.style.top = `${y}px`;
  actionMenu.style.display = "block";
}
menuClose.onclick = () => { actionMenu.style.display = "none"; actionTarget = null; };

/* Vote for leader (writes my vote under matches/default/votes/{roomId}/{myUid}) */
menuVote.onclick = async () => {
  if (!uid || !actionTarget) return;
  await set(ref(db, `matches/default/votes/${actionTarget.roomId}/${uid}`), actionTarget.uid);
  actionMenu.style.display = "none";
  alert(`You voted for ${actionTarget.name} as leader in ${actionTarget.roomId}.`);
};

/* Private message modal */
menuPrivateMsg.onclick = () => {
  if (!actionTarget) return;
  openModal(`Private message to ${actionTarget.name}`, createMessageForm(), async () => {
    const text = document.getElementById("modalInput").value.trim();
    if (text) {
      const msgRef = push(ref(db, `inboxes/${actionTarget.uid}/messages`));
      await set(msgRef, { fromUid: uid, fromName: displayName, text, ts: Date.now(), roomMessage: false });
    }
  });
  actionMenu.style.display = "none";
};

/* Private reveal color */
menuRevealColor.onclick = () => {
  if (!actionTarget) return;
  openModal(`Reveal color to ${actionTarget.name}`, createRevealForm("color"), async () => {
    const color = document.getElementById("modalSelect").value;
    await set(ref(db, `privateReveals/${actionTarget.uid}/${uid}`), { role: color, revealedAt: Date.now() });
  });
  actionMenu.style.display = "none";
};

/* Private reveal role */
menuRevealRole.onclick = () => {
  if (!actionTarget) return;
  openModal(`Reveal role to ${actionTarget.name}`, createRevealForm("role"), async () => {
    const role = document.getElementById("modalSelect").value;
    await set(ref(db, `privateReveals/${actionTarget.uid}/${uid}`), { role, revealedAt: Date.now() });
  });
  actionMenu.style.display = "none";
};

/* Mark/unmark hostage target (writes to room node) */
menuMarkHostage.onclick = async () => {
  if (!actionTarget) return;
  const roomKey = actionTarget.roomId;
  const current = (await get(ref(db, `matches/default/rooms/${roomKey}/hostageTargetUid`))).val();
  if (current === actionTarget.uid) {
    await set(ref(db, `matches/default/rooms/${roomKey}/hostageTargetUid`), null);
    alert(`${actionTarget.name} unmarked as hostage.`);
  } else {
    await set(ref(db, `matches/default/rooms/${roomKey}/hostageTargetUid`), actionTarget.uid);
    alert(`${actionTarget.name} marked as hostage.`);
  }
  actionMenu.style.display = "none";
};

/* ---------------------------
   Modal helpers
   --------------------------- */
function openModal(title, bodyEl, onConfirm) {
  modalTitle.textContent = title;
  modalBody.innerHTML = "";
  modalBody.appendChild(bodyEl);
  modalOverlay.style.display = "flex";
  modalCancel.onclick = () => { modalOverlay.style.display = "none"; };
  modalConfirm.onclick = async () => { await onConfirm(); modalOverlay.style.display = "none"; };
}
function createMessageForm() {
  const wrapper = document.createElement("div");
  const ta = document.createElement("textarea");
  ta.id = "modalInput"; ta.rows = 4; ta.placeholder = "Type private message...";
  wrapper.appendChild(ta);
  return wrapper;
}
function createRevealForm(type) {
  const wrapper = document.createElement("div");
  const select = document.createElement("select"); select.id = "modalSelect";
  if (type === "color") {
    const o1 = new Option("Red","Red"); const o2 = new Option("Blue","Blue");
    select.add(o1); select.add(o2);
  } else {
    const o1 = new Option("President","President"); const o2 = new Option("Bomber","Bomber");
    select.add(o1); select.add(o2);
  }
  wrapper.appendChild(select);
  return wrapper;
}

/* ---------------------------
   Inbox & private reveals listeners
   - inbox: matches default inboxes/inboxes/{uid}/messages
   - private reveals: privateReveals/{myUid} (only I can read)
   --------------------------- */
function attachInboxListener(myUid) {
  onValue(ref(db, `inboxes/${myUid}/messages`), snap => {
    const msgs = snap.val() || {};
    const arr = Object.keys(msgs).map(k => ({ id: k, ...msgs[k] }));
    arr.sort((a,b) => (a.ts||0)-(b.ts||0));
    messagesEl.innerHTML = "";
    for (const m of arr) {
      const p = document.createElement("p");
      if (m.roomMessage) p.innerHTML = `<strong>[Room ${m.room}] ${m.fromName || m.fromUid}:</strong> ${m.text}`;
      else p.innerHTML = `<em>Private from ${m.fromName || m.fromUid}:</em> ${m.text}`;
      messagesEl.appendChild(p);
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}

function attachPrivateRevealsListener(myUid) {
  onValue(ref(db, `privateReveals/${myUid}`), snap => {
    privateRevealsForMe = snap.val() || {};
    // re-render rooms so reveals show up
    renderRoom("roomA", playersA, "roomA");
    renderRoom("roomB", playersB, "roomB");
  });
}

/* ---------------------------
   Room chat: deliver message to each player's inbox in the room
   --------------------------- */
sendBtn.onclick = sendRoomMessage;
chatInput.addEventListener("keypress", e => { if (e.key === "Enter") sendRoomMessage(); });

async function sendRoomMessage() {
  if (!isJoined) { alert("Join first"); return; }
  const text = chatInput.value.trim(); if (!text) return;
  const playersSnap = await get(ref(db, `matches/default/rooms/${currentRoom}/players`));
  const players = playersSnap.exists() ? Object.keys(playersSnap.val()) : [];
  const ts = Date.now();
  const promises = players.map(targetUid => {
    const msgRef = push(ref(db, `inboxes/${targetUid}/messages`));
    return set(msgRef, { fromUid: uid, fromName: displayName, text, ts, roomMessage: true, room: currentRoom });
  });
  await Promise.all(promises);
  chatInput.value = "";
}

/* ---------------------------
   Seed roles (callable function)
   - assumes a Cloud Function 'seedRoles' is deployed
   --------------------------- */
seedRolesBtn.onclick = async () => {
  if (!uid) { alert("Sign in first"); return; }
  const seed = httpsCallable(functions, 'seedRoles');
  try {
    await seed({ matchId: 'default' });
    alert("Roles seeded (server-side).");
  } catch (e) { alert("Seed failed: " + e.message); }
};

/* ---------------------------
   Tally votes (callable function or client-side)
   - prefer server-side function 'tallyVotes' if deployed
   --------------------------- */
tallyVotesBtn.onclick = async () => {
  const tally = httpsCallable(functions, 'tallyVotes');
  try {
    await tally({ matchId: 'default' });
    alert("Votes tallied (server-side).");
  } catch (e) {
    // fallback: client-side tally
    await clientTallyVotes();
  }
};

async function clientTallyVotes() {
  const rooms = ['roomA','roomB'];
  for (const r of rooms) {
    const votesSnap = await get(ref(db, `matches/default/votes/${r}`));
    const votes = votesSnap.exists() ? votesSnap.val() : {};
    const counts = {};
    Object.values(votes).forEach(v => counts[v] = (counts[v]||0)+1);
    let winner = null; let max = -1;
    for (const [candidate, c] of Object.entries(counts)) if (c > max) { max = c; winner = candidate; }
    await set(ref(db, `matches/default/rooms/${r}/leaderUid`), winner || null);
  }
  alert("Client-side tally complete.");
}

/* ---------------------------
   Exchange (callable function preferred)
   - requestExchange Cloud Function should verify leader and exchange window
   - fallback: client attempts to perform exchange if leader
   --------------------------- */
exchangeBtn.onclick = async () => {
  if (!uid) { alert("Sign in first"); return; }
  const req = httpsCallable(functions, 'requestExchange');
  try {
    await req({ matchId: 'default', roomId: currentRoom });
    alert("Exchange executed (server-side).");
  } catch (e) {
    // fallback: client-side attempt (leader only)
    await clientExecuteExchange();
  }
};

async function clientExecuteExchange() {
  const leaderSnap = await get(ref(db, `matches/default/rooms/${currentRoom}/leaderUid`));
  const leaderUid = leaderSnap.exists() ? leaderSnap.val() : null;
  if (leaderUid !== uid) { alert("Only leader can execute exchange."); return; }
  const targetSnap = await get(ref(db, `matches/default/rooms/${currentRoom}/hostageTargetUid`));
  let targetUid = targetSnap.exists() ? targetSnap.val() : null;
  if (!targetUid) {
    const playersSnap = await get(ref(db, `matches/default/rooms/${currentRoom}/players`));
    const players = playersSnap.exists() ? Object.keys(playersSnap.val()) : [];
    const choice = prompt(`No hostage target set. Enter player UID to move (or leave blank to move yourself):\n${players.join(", ")}`);
    if (choice && players.includes(choice)) targetUid = choice;
    else targetUid = uid;
  }
  const newRoom = currentRoom === "roomA" ? "roomB" : "roomA";
  const infoSnap = await get(ref(db, `matches/default/rooms/${currentRoom}/players/${targetUid}`));
  const info = infoSnap.exists() ? infoSnap.val() : { displayName: "Unknown" };
  await set(ref(db, `matches/default/rooms/${newRoom}/players/${targetUid}`), info);
  await remove(ref(db, `matches/default/rooms/${currentRoom}/players/${targetUid}`));
  await set(ref(db, `matches/default/rooms/${currentRoom}/hostageTargetUid`), null);
  await set(ref(db, `matches/default/rooms/${currentRoom}/leaderUid`), null);
  if (targetUid === uid) currentRoom = newRoom;
  alert(`Moved ${targetUid} to ${newRoom}.`);
}

/* ---------------------------
   Round state (DB-authoritative)
   - stored at matches/default/round
   - startRound writes hostUid and running=true; host writes ticks
   --------------------------- */
startRoundBtn.onclick = async () => {
  if (!uid) { alert("Sign in first"); return; }
  // attempt to become host and start
  await set(ref(db, `matches/default/round`), { timeLeft: 180, phase: "discussion", running: true, hostUid: uid, lastTick: Date.now() });
  startAuthoritativeTicker();
};

stopRoundBtn.onclick = async () => {
  await set(ref(db, `matches/default/round`), { timeLeft: 0, phase: "stopped", running: false, hostUid: null, lastTick: Date.now() });
  stopAuthoritativeTicker();
};

function attachRoundListener() {
  onValue(ref(db, `matches/default/round`), snap => {
    const r = snap.val() || { timeLeft: 180, phase: "idle", running: false, hostUid: null };
    timerEl.textContent = r.timeLeft ?? 180;
    phaseEl.textContent = `Phase: ${r.phase ?? "idle"}`;
    roundHostEl.textContent = `Host: ${r.hostUid ? r.hostUid.slice(0,6) : "(none)"}`;
  });
}

function startAuthoritativeTicker() {
  if (roundLocalInterval) clearInterval(roundLocalInterval);
  roundLocalInterval = setInterval(async () => {
    const roundRef = ref(db, `matches/default/round`);
    const snap = await get(roundRef);
    const r = snap.val() || {};
    if (!r.running) { clearInterval(roundLocalInterval); roundLocalInterval = null; return; }
    // only host should write; ensure hostUid matches me
    if (r.hostUid !== uid) { clearInterval(roundLocalInterval); roundLocalInterval = null; return; }
    let timeLeft = (r.timeLeft ?? 180) - 1;
    let phase = timeLeft <= 20 ? "exchange" : "discussion";
    if (timeLeft <= 0) {
      // end round
      await set(roundRef, { timeLeft: 0, phase: "ended", running: false, hostUid: null, lastTick: Date.now() });
      clearInterval(roundLocalInterval); roundLocalInterval = null;
      return;
    }
    await set(roundRef, { timeLeft, phase, running: true, hostUid: uid, lastTick: Date.now() });
  }, 1000);
}

function stopAuthoritativeTicker() {
  if (roundLocalInterval) { clearInterval(roundLocalInterval); roundLocalInterval = null; }
}

/* ---------------------------
   Private reveals listener for me
   --------------------------- */
function attachPrivateRevealsListener(myUid) {
  onValue(ref(db, `privateReveals/${myUid}`), snap => {
    privateRevealsForMe = snap.val() || {};
    // re-render rooms so reveals show
    renderRoom("roomA", playersA, "roomA");
    renderRoom("roomB", playersB, "roomB");
  });
}

/* ---------------------------
   Utility: safe get
   --------------------------- */
async function safeGet(path) {
  const snap = await get(ref(db, path));
  return snap.exists() ? snap.val() : null;
}

/* ---------------------------
   Initial render calls (rooms will update when players join)
   --------------------------- */
renderRoom("roomA", playersA, "roomA");
renderRoom("roomB", playersB, "roomB");
renderLeaderLabels();
attachRoundListener();

/* ---------------------------
   When user signs in, set displayName variable from auth or meta
   --------------------------- */
onAuthStateChanged(auth, async user => {
  if (!user) return;
  // try to read playersMeta if exists
  const meta = await safeGet(`playersMeta/${user.uid}`);
  displayName = meta && meta.displayName ? meta.displayName : (user.displayName || `Player-${user.uid.slice(0,6)}`);
  // update UI label
  document.getElementById("userLabel").textContent = `${displayName} (${user.uid.slice(0,6)})`;
});
