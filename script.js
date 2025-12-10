// Import Firebase SDK
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import { getDatabase, ref, set, push, onValue } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-database.js";

// Firebase config
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

let playerName = null;
let currentRoom = "roomA"; // default

// --- Join Game ---
function joinGame() {
  playerName = document.getElementById("playerNameInput").value || "Player" + Math.floor(Math.random() * 1000);
  set(ref(db, `rooms/${currentRoom}/players/${playerName}`), {
    role: "Unknown",
    revealed: false,
    leader: false
  });
  document.getElementById("nameSelect").style.display = "none";
}
window.joinGame = joinGame;

// --- Chat ---
function sendMessage() {
  const input = document.getElementById("chatInput").value;
  if (!input) return;
  const msgRef = push(ref(db, `rooms/${currentRoom}/chat`));
  set(msgRef, { sender: playerName, text: input });
  document.getElementById("chatInput").value = "";
}
window.sendMessage = sendMessage;

// Enter key sends message
document.getElementById("chatInput").addEventListener("keypress", function(e) {
  if (e.key === "Enter") sendMessage();
});

// --- Reveal Color ---
function revealColor() {
  const color = Math.random() > 0.5 ? "Red" : "Blue";
  set(ref(db, `rooms/${currentRoom}/players/${playerName}`), {
    role: color,
    revealed: true,
    leader: false
  });
}
window.revealColor = revealColor;

// --- Reveal Role ---
function revealRole() {
  const role = Math.random() > 0.5 ? "President" : "Bomber";
  set(ref(db, `rooms/${currentRoom}/players/${playerName}`), {
    role: role,
    revealed: true,
    leader: false
  });
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

// --- Hostage Exchange ---
function exchangeHostage() {
  // Move current player to opposite room
  const newRoom = currentRoom === "roomA" ? "roomB" : "roomA";
  set(ref(db, `rooms/${newRoom}/players/${playerName}`), {
    role: "Unknown",
    revealed: false,
    leader: false
  });
  set(ref(db, `rooms/${currentRoom}/players/${playerName}`), null);
  currentRoom = newRoom;
}
window.exchangeHostage = exchangeHostage;

// --- Sync UI ---
function renderPlayers(roomId, containerId) {
  onValue(ref(db, `rooms/${roomId}/players`), snapshot => {
    const players = snapshot.val() || {};
    const container = document.getElementById(containerId);
    container.innerHTML = "";
    for (let p in players) {
      let emoji = "";
      if (players[p].revealed) {
        if (players[p].role === "President") emoji = "👑";
        else if (players[p].role === "Bomber") emoji = "💣";
        else if (players[p].role === "Red") emoji = "🔴";
        else if (players[p].role === "Blue") emoji = "🔵";
      }
      container.innerHTML += `<div class="player">${p} ${emoji}</div>`;
    }
  });
}

renderPlayers("roomA", "playersA");
renderPlayers("roomB", "playersB");

onValue(ref(db, `rooms/${currentRoom}/chat`), snapshot => {
  const messages = snapshot.val() || {};
  const container = document.getElementById("messages");
  container.innerHTML = "";
  for (let m in messages) {
    container.innerHTML += `<p><strong>${messages[m].sender}:</strong> ${messages[m].text}</p>`;
  }
});
