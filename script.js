// Import Firebase SDK
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import { getDatabase, ref, set, push, onValue } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-database.js";

// Your Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyB7fXtog_41paX_ucqFadY4_qaDkBOFdP8",
  authDomain: "twowebbrowsers.firebaseapp.com",
  projectId: "twowebbrowsers",
  storageBucket: "twowebbrowsers.firebasestorage.app",
  messagingSenderId: "187940323050",
  appId: "1:187940323050:web:be4be5d2dd748664692193"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// --- Demo player setup ---
const playerName = "Player" + Math.floor(Math.random() * 1000);
const currentRoom = "roomA"; // default for demo

// Add player to database
set(ref(db, `rooms/${currentRoom}/players/${playerName}`), {
  role: "Unknown",
  revealed: false,
  leader: false
});

// --- Chat ---
function sendMessage() {
  const input = document.getElementById("chatInput").value;
  if (!input) return;
  const msgRef = push(ref(db, `rooms/${currentRoom}/chat`));
  set(msgRef, { sender: playerName, text: input });
  document.getElementById("chatInput").value = "";
}
window.sendMessage = sendMessage;

// --- Reveal Color ---
function revealColor() {
  set(ref(db, `rooms/${currentRoom}/players/${playerName}/revealed`), true);
  set(ref(db, `rooms/${currentRoom}/players/${playerName}/role`), "Red/Blue");
}
window.revealColor = revealColor;

// --- Reveal Role ---
function revealRole() {
  set(ref(db, `rooms/${currentRoom}/players/${playerName}/revealed`), true);
  set(ref(db, `rooms/${currentRoom}/players/${playerName}/role`), "Bomber/President");
}
window.revealRole = revealRole;

// --- Leader Voting ---
function voteLeader() {
  set(ref(db, `rooms/${currentRoom}/leader`), playerName);
}
window.voteLeader = voteLeader;

function unpromoteLeader() {
  set(ref(db, `rooms/${currentRoom}/leader`), null);
}
window.unpromoteLeader = unpromoteLeader;

// --- Sync UI ---
onValue(ref(db, `rooms/${currentRoom}/players`), snapshot => {
  const players = snapshot.val() || {};
  const container = document.getElementById("playersA");
  container.innerHTML = "";
  for (let p in players) {
    let leaderBadge = players[p].leader ? "👑" : "";
    let revealBadge = players[p].revealed ? `(${players[p].role})` : "";
    container.innerHTML += `<div class="player">${p} ${leaderBadge} ${revealBadge}</div>`;
  }
});

onValue(ref(db, `rooms/${currentRoom}/chat`), snapshot => {
  const messages = snapshot.val() || {};
  const container = document.getElementById("messages");
  container.innerHTML = "";
  for (let m in messages) {
    container.innerHTML += `<p><strong>${messages[m].sender}:</strong> ${messages[m].text}</p>`;
  }
});
