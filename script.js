// Firebase v9 modular imports
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  push,
  onValue,
  update,
  remove,
  get,
  child
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-database.js";

/* ---------------------------
   Firebase config (include databaseURL)
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

/* ---------------------------
   State & DOM refs
   --------------------------- */
let playerName = null;
let currentRoom = "roomA";
let privateRevealsForMe = {}; // cache of reveals given to me: { sourceName: {role, revealedAt} }

const joinBtn = document.getElementById("joinBtn");
const playerNameInput = document.getElementById("playerNameInput");
const messagesEl = document.getElementById("messages");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");
const revealColorBtn = document.getElementById("revealColorBtn");
const revealRoleBtn = document.getElementById("revealRoleBtn");
const exchangeBtn = document.getElementById("exchangeBtn");
const leaderAEl = document.getElementById("leaderA");
const leaderBEl = document.getElementById("leaderB");
const timerEl = document.getElementById("timer");
const phaseEl = document.getElementById("phase");

/* ---------------------------
   Join game
   --------------------------- */
joinBtn.onclick = async () => {
  playerName = (playerNameInput.value || "").trim() || "Player" + Math.floor(Math.random() * 1000);

  // Add player to current room (public node keeps role "Unknown" unless you choose to reveal publicly later; by user request we do not do public reveals)
  await set(ref(db, `rooms/${currentRoom}/players/${playerName}`), {
    role: "Unknown",
    revealed: false
  });

  document.getElementById("nameSelect").style.display = "none";

  // Render both rooms and leader labels
  renderRoom("roomA", "playersA");
  renderRoom("roomB", "playersB");
  renderLeaderLabels();

  // Attach inbox listener for me (my personal inbox)
  attachInboxListener(playerName);

  // Attach private reveals listener for me
  attachPrivateRevealsListener(playerName);
};

/* ---------------------------
   Room chat: send message to each player in the room's inbox
   --------------------------- */
sendBtn.onclick = sendRoomMessage;
chatInput.addEventListener("keypress", e => { if (e.key === "Enter") sendRoomMessage(); });

async function sendRoomMessage() {
  const text = chatInput.value.trim();
  if (!text || !playerName) return;
  // Get list of players currently in the room
  const playersSnap = await get(child(ref(db), `rooms/${currentRoom}/players`));
  const players = playersSnap.exists() ? playersSnap.val() : {};
  const ts = Date.now();

  // For each player in the room, push a message into their inbox
  const promises = Object.keys(players).map(target => {
    const msgRef = push(ref(db, `inboxes/${target}/messages`));
    return set(msgRef, {
      from: playerName,
      text,
      ts,
      roomMessage: true,
      room: currentRoom
    });
  });

  await Promise.all(promises);
  chatInput.value = "";
}

/* ---------------------------
   Private message helper (to a single target)
   --------------------------- */
async function sendPrivateMessage(target, text) {
  if (!playerName || !target || !text) return;
  const msgRef = push(ref(db, `inboxes/${target}/messages`));
  await set(msgRef, {
    from: playerName,
    text,
    ts: Date.now(),
    roomMessage: false
  });
}

/* ---------------------------
   Private reveal helper (reveal to a single target)
   stored at privateReveals/{target}/{source}
   --------------------------- */
async function revealToTarget(target, revealPayload) {
  if (!playerName || !target) return;
  await set(ref(db, `privateReveals/${target}/${playerName}`), {
    ...revealPayload,
    revealedAt: Date.now()
  });
}

/* ---------------------------
   Reveal buttons: always choose a target player in the current room
   (no public reveals)
   --------------------------- */
revealColorBtn.onclick = async () => {
  if (!playerName) return;
  const target = await chooseTargetInRoom(currentRoom);
  if (!target) return;
  const color = Math.random() > 0.5 ? "Red" : "Blue";
  await revealToTarget(target, { role: color });
  alert(`You revealed your color (${color}) to ${target}.`);
};

revealRoleBtn.onclick = async () => {
  if (!playerName) return;
  const target = await chooseTargetInRoom(currentRoom);
  if (!target) return;
  const role = Math.random() > 0.5 ? "President" : "Bomber";
  await revealToTarget(target, { role });
  alert(`You revealed your role (${role}) to ${target}.`);
};

/* ---------------------------
   Helper: prompt to choose a target from players currently in a room
   returns the chosen player name or null
   --------------------------- */
async function chooseTargetInRoom(roomId) {
  const playersSnap = await get(ref(db, `rooms/${roomId}/players`));
  if (!playersSnap.exists()) {
    alert("No players in the room to choose.");
    return null;
  }
  const players = Object.keys(playersSnap.val()).filter(n => n !== playerName);
  if (players.length === 0) {
    const selfChoice = confirm("No other players in the room. Reveal to yourself?");
    return selfChoice ? playerName : null;
  }
  const list = players.join(", ");
  const choice = prompt(`Choose a player to reveal to (type exact name):\n${list}`);
  if (!choice) return null;
  if (!players.includes(choice)) {
    alert("Invalid player name.");
    return null;
  }
  return choice;
}

/* ---------------------------
   Render room players
   - shows only private reveals that the current viewer has been given
   - clicking a player opens a small action menu (toggle leader / private message / private reveal / mark hostage)
   --------------------------- */
function renderRoom(roomId, containerId) {
  const playersRef = ref(db, `rooms/${roomId}/players`);
  const leaderRef = ref(db, `rooms/${roomId}/leader`);
  onValue(playersRef, async snapshot => {
    const players = snapshot.val() || {};
    const container = document.getElementById(containerId);
    container.innerHTML = "";

    // Pre-fetch leader once for styling
    const leaderSnap = await get(leaderRef);
    const leaderName = leaderSnap.exists() ? leaderSnap.val() : null;

    for (const name of Object.keys(players)) {
      const info = players[name];
      const div = document.createElement("div");
      div.className = "player";

      // Apply leader style if applicable
      if (leaderName === name) div.classList.add("leader");

      // Determine display text and emoji based only on private reveals for me
      let displayText = name;
      let emoji = "";

      const privateReveal = privateRevealsForMe[name];
      if (privateReveal && privateReveal.role) {
        const r = privateReveal.role;
        if (r === "Red") { div.classList.add("red"); emoji = "🔴"; }
        else if (r === "Blue") { div.classList.add("blue"); emoji = "🔵"; }
        else if (r === "President") emoji = "👑";
        else if (r === "Bomber") emoji = "💣";
        displayText = `${name} ${emoji}`;
      } else {
        // No private reveal for me; show only the name (no public reveals)
        displayText = name;
      }

      div.textContent = displayText;

      // Click handler: open a small action prompt
      div.onclick = async (e) => {
        e.stopPropagation();
        const action = prompt(
`Actions for ${name} (enter number):
1) Toggle leader
2) Private message
3) Reveal color to this player (private)
4) Reveal role to this player (private)
5) Mark/unmark hostage target (leader only)
(Leave blank to cancel)`
        );
        if (!action) return;

        if (action === "1") {
          // toggle leader
          const leaderSnap2 = await get(leaderRef);
          const currentLeader = leaderSnap2.exists() ? leaderSnap2.val() : null;
          if (currentLeader === name) await set(leaderRef, null);
          else await set(leaderRef, name);
          return;
        }

        if (action === "2") {
          const text = prompt(`Private message to ${name}:`);
          if (text) await sendPrivateMessage(name, text);
          return;
        }

        if (action === "3") {
          const color = Math.random() > 0.5 ? "Red" : "Blue";
          await revealToTarget(name, { role: color });
          alert(`You revealed your color (${color}) to ${name}.`);
          return;
        }

        if (action === "4") {
          const role = Math.random() > 0.5 ? "President" : "Bomber";
          await revealToTarget(name, { role });
          alert(`You revealed your role (${role}) to ${name}.`);
          return;
        }

        if (action === "5") {
          const currentTargetSnap = await get(ref(db, `rooms/${roomId}/hostageTarget`));
          const currentTarget = currentTargetSnap.exists() ? currentTargetSnap.val() : null;
          if (currentTarget === name) {
            await set(ref(db, `rooms/${roomId}/hostageTarget`), null);
            alert(`${name} unmarked as hostage target.`);
          } else {
            await set(ref(db, `rooms/${roomId}/hostageTarget`), name);
            alert(`${name} marked as hostage target.`);
          }
          return;
        }
      };

      container.appendChild(div);
    }
  });
}

/* ---------------------------
   Leader labels
   --------------------------- */
function renderLeaderLabels() {
  onValue(ref(db, "rooms/roomA/leader"), snap => {
    const leader = snap.val();
    leaderAEl.textContent = `Leader: ${leader || "(none)"}`;
  });
  onValue(ref(db, "rooms/roomB/leader"), snap => {
    const leader = snap.val();
    leaderBEl.textContent = `Leader: ${leader || "(none)"}`;
  });
}

/* ---------------------------
   Inbox listener (my personal inbox)
   - shows both room messages (labeled) and private messages
   - room messages are delivered to inboxes of players present at send time
   --------------------------- */
function attachInboxListener(viewerName) {
  if (!viewerName) return;
  const inboxRef = ref(db, `inboxes/${viewerName}/messages`);
  onValue(inboxRef, snapshot => {
    const msgs = snapshot.val() || {};
    const arr = Object.keys(msgs).map(k => ({ id: k, ...msgs[k] }));
    arr.sort((a, b) => (a.ts || 0) - (b.ts || 0));

    messagesEl.innerHTML = "";
    for (const m of arr) {
      const p = document.createElement("p");
      if (m.roomMessage) {
        p.innerHTML = `<strong>[Room ${m.room}] ${m.from}:</strong> ${m.text}`;
      } else {
        p.innerHTML = `<em>Private from ${m.from}:</em> ${m.text}`;
      }
      messagesEl.appendChild(p);
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}

/* ---------------------------
   Private reveals listener for me
   - caches reveals given to me so renderRoom can show them
   --------------------------- */
function attachPrivateRevealsListener(viewerName) {
  if (!viewerName) return;
  onValue(ref(db, `privateReveals/${viewerName}`), snap => {
    privateRevealsForMe = snap.val() || {};
    // Re-render both rooms so reveals are visible immediately
    renderRoom("roomA", "playersA");
    renderRoom("roomB", "playersB");
  });
}

/* ---------------------------
   Hostage exchange
   - Only leader of the room can perform exchange
   - Exchange window enforced by timer (last 20s)
   - Leader moves the marked hostage target (rooms/{roomId}/hostageTarget) to the other room
   - If no hostageTarget set, leader can choose a target or move themselves
   --------------------------- */
exchangeBtn.onclick = async () => {
  if (!playerName) return;
  if (!inExchangeWindow) {
    alert("Hostage exchange only allowed during the exchange window (last 20 seconds).");
    return;
  }

  // Check leader for current room
  const leaderSnap = await get(ref(db, `rooms/${currentRoom}/leader`));
  const leader = leaderSnap.exists() ? leaderSnap.val() : null;
  if (leader !== playerName) {
    alert("Only the leader can perform the hostage exchange.");
    return;
  }

  // Get hostage target
  const targetSnap = await get(ref(db, `rooms/${currentRoom}/hostageTarget`));
  let target = targetSnap.exists() ? targetSnap.val() : null;
  if (!target) {
    // If none set, ask leader to choose
    const playersSnap = await get(ref(db, `rooms/${currentRoom}/players`));
    const players = playersSnap.exists() ? Object.keys(playersSnap.val()) : [];
    const choice = prompt(`No hostage target set. Enter player name to move (or leave blank to move yourself):\n${players.join(", ")}`);
    if (choice && players.includes(choice)) target = choice;
    else target = playerName;
  }

  // Move target to other room
  const newRoom = currentRoom === "roomA" ? "roomB" : "roomA";
  const playerInfoSnap = await get(ref(db, `rooms/${currentRoom}/players/${target}`));
  const info = playerInfoSnap.exists() ? playerInfoSnap.val() : { role: "Unknown", revealed: false };

  await set(ref(db, `rooms/${newRoom}/players/${target}`), info);
  await remove(ref(db, `rooms/${currentRoom}/players/${target}`));

  // Clear hostage target and leader in old room
  await set(ref(db, `rooms/${currentRoom}/hostageTarget`), null);
  await set(ref(db, `rooms/${currentRoom}/leader`), null);

  // If I moved, update my currentRoom
  if (target === playerName) {
    currentRoom = newRoom;
  }

  alert(`${target} moved to ${newRoom}.`);
};

/* ---------------------------
   Round timer & exchange window
   --------------------------- */
let timeLeft = 180;
let inExchangeWindow = false;

function startTimer() {
  setInterval(() => {
    timeLeft -= 1;
    if (timeLeft <= 0) {
      // Reset round
      timeLeft = 180;
      inExchangeWindow = false;
      phaseEl.textContent = "Phase: Discussion";
    } else if (timeLeft <= 20) {
      inExchangeWindow = true;
      phaseEl.textContent = "Phase: Hostage Exchange Window";
    } else {
      inExchangeWindow = false;
      phaseEl.textContent = "Phase: Discussion";
    }
    timerEl.textContent = timeLeft;
  }, 1000);
}
startTimer();
