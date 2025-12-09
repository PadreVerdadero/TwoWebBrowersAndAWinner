<script>
function sendMessage() {
  const input = document.getElementById("chatInput").value;
  const messages = document.getElementById("messages");
  messages.innerHTML += `<p>${input}</p>`;
}

function revealColor() {
  alert("You revealed your team color!");
}

function revealRole() {
  alert("You revealed your full role!");
}

function voteLeader() {
  alert("You voted for a leader!");
}

function unpromoteLeader() {
  alert("Leader removed!");
}
</script>
