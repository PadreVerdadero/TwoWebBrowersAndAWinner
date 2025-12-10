// Firebase v9 (modular) imports
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  push,
  onValue,
  update,
  remove
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-database.js";

// Firebase config (with databaseURL added)
const firebaseConfig = {
  apiKey: "AIzaSyB7fXtog_41paX_ucqFadY4_qaDkBOFdP8",
  authDomain: "twowebbrowsers.firebaseapp.com",
  projectId: "twowebbrowsers",
  storageBucket: "twowebbrowsers.firebasestorage.app",
  messagingSenderId: "187940323050",
  appId: "1:187940323050:web:be4be5d2dd748664692193",
  databaseURL: "https://twowebbrowsers-default-rtdb.firebaseio.com"
};

// Init
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// State
let playerName = null;
let currentRoom = "roomA";
let chatUnsub = null;

// DOM
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

// Join
joinBtn.onclick = async () => {
  playerName = (playerNameInput.value || "").trim() || "Player" + Math.floor(Math.random() * 1000);

  // Create player in current room
  await set(ref(db, `rooms/${currentRoom}/players/${playerName}`), {
    role: "Unknown",
    revealed: false
  });

  // Hide name select
  document.getElementById("nameSelect").style.display = "none";

  // Attach listeners
  renderRoom("roomA", "playersA");
  renderRoom("roomB", "playersB");
  renderLeaderLabels();
  attachChatListener(currentRoom);
};

// Chat
sendBtn.onclick = () => sendMessage();
chatInput.addEventListener("keypress", e => {
  if (e.key === "Enter") sendMessage();
});

function sendMessage() {
  const text = chatInput.value.trim();
  if (!text || !playerName) return;
  const msgRef = push(ref(db, `rooms/${currentRoom}/chat`));
  set(msgRef, { sender: playerName, text });
  chatInput.value = "";
}

function attachChatListener(roomId) {
  // Detach previous chat listener if any (simple replace by re-attaching)
  onValue(ref(db, `rooms/${roomId}/chat`), snapshot => {
    const messages = snapshot.val() || {};
    messagesEl.innerHTML = "";
    Object.keys(messages).forEach(k => {
      const { sender, text } = messages[k];
      const p = document.createElement("p");
      p.innerHTML = `<strong>${sender}:</strong> ${text}`;
      messagesEl.appendChild(p);
    });
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}

// Reveal color (Red/Blue): sets background and a circle emoji; latest instruction: emoji only for team members
revealColorBtn.onclick = async () => {
  if (!playerName) return;
  const color = Math.random() > 0.5 ? "Red" : "Blue";
  await update(ref(db, `rooms/${currentRoom}/players/${playerName}`), {
    role: color,
    revealed: true
  });
};

// Reveal role (President/Bomber): no emoji (per latest instruction)
revealRoleBtn.onclick = async () => {
  if (!playerName) return;
  const role = Math.random() > 0.5 ? "President" : "Bomber";
  await update(ref(db, `rooms/${currentRoom}/players/${playerName}`), {
    role: role,
    revealed: true
  });
};

// Render rooms and handle click-to-leader toggle
function renderRoom(roomId, containerId) {
  const playersRef = ref(db, `rooms/${roomId}/players`);
  const leaderRef = ref(db, `rooms/${roomId}/leader`);

  onValue(playersRef, snapshot => {
    const players = snapshot.val() || {};
    const container = document.getElementById(containerId);
    container.innerHTML = "";

    Object.keys(players).forEach(name => {
      const info = players[name];

      const div = document.createElement("div");
      div.className = "player";

      // Background color for team reveals
      if (info.revealed && info.role === "Red") div.classList.add("red");
      if (info.revealed && info.role === "Blue") div.classList.add("blue");

      // Emoji only for team members (Red/Blue). No emoji for President/Bomber per latest instruction.
      const emoji = info.revealed && (info.role === "Red" || info.role === "Blue")
        ? (info.role === "Red" ? "🔴" : "🔵")
        : "";

      div.textContent = `${name} ${emoji}`;
      div.title = "Click to toggle leader for this room";

      // Clicking toggles leader: if this is the leader, unpromote; otherwise promote
      div.onclick = async () => {
        const snap = await new Promise(res => onValue(leaderRef, res, { onlyOnce: true }));
        const currentLeader = snap.val();
        if (currentLeader === name) {
          await set(leaderRef, null);
        } else {
          await set(leaderRef, name);
        }
      };

      // Reflect leader style
      onValue(leaderRef, snap => {
        const leaderName = snap.val();
        if (leaderName === name) div.classList.add("leader");
        else div.classList.remove("leader");
      });

      container.appendChild(div);
    });
  });
}

// Show leader labels at the top of rooms
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

// Hostage exchange: only leader can exchange; only during exchange window; demo moves self to other room.
// Later you can add UI to select another player to move.
exchangeBtn.onclick = async () => {
  if (!playerName) return;

  if (!inExchangeWindow) {
    alert("Hostage exchange is only allowed during the exchange window (last 20 seconds).");
    return;
  }

  // Check leader for current room
  const snap = await new Promise(res => onValue(ref(db, `rooms/${currentRoom}/leader`), res, { onlyOnce: true }));
  const leader = snap.val();
  if (leader !== playerName) {
    alert("Only the leader can perform the hostage exchange.");
    return;
  }

  // Move current player to the other room
  const newRoom = currentRoom === "roomA" ? "roomB" : "roomA";
  const playerSnap = await new Promise(res => onValue(ref(db, `rooms/${currentRoom}/players/${playerName}`), res, { onlyOnce: true }));
  const info = playerSnap.val() || { role: "Unknown", revealed: false };

  await set(ref(db, `rooms/${newRoom}/players/${playerName}`), info);
  await remove(ref(db, `rooms/${currentRoom}/players/${playerName}`));
  await set(ref(db, `rooms/${currentRoom}/leader`), null); // old room loses leader

  currentRoom = newRoom;
  attachChatListener(currentRoom);
};

// Round timer and phases
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
