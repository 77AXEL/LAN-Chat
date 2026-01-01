(function () {
  function setAppHeight() {
    const doc = document.documentElement;
    doc.style.setProperty('--app-height', `${window.innerHeight}px`);
  }
  window.addEventListener('resize', setAppHeight);
  window.addEventListener('orientationchange', setAppHeight);
  setAppHeight();
})();

const socket = io();
let myUsername = null;
let activeRecipient = null;
let isLoggedIn = false;

const conversations = {};
const unreadCounts = {};

const usersViewEl = document.getElementById("users-view");
const chatViewEl = document.getElementById("chat-view");
const userListEl = document.getElementById("user-list");
const chatContainerEl = document.getElementById("chat-container");
const msgInputEl = document.getElementById("msg_area");
const sendBtnEl = document.getElementById("send_btn");
const chatHeaderEl = document.getElementById("chat-header");
const chatUsernameEl = document.getElementById("chat-username");
const myUsernameBadgeEl = document.getElementById("my-username-badge");
const emptyStateEl = document.getElementById("empty-state");
const messagesScrollEl = document.getElementById("messages-scroll");
const inputAreaEl = document.getElementById("input-area");
const backBtnEl = document.getElementById("back-btn");
const searchUsersEl = document.getElementById("search-users");
const typingIndicatorEl = document.getElementById("typing-indicator");
const logoutBtnEl = document.getElementById("logout-btn");

const nameModalEl = document.getElementById("name-modal");
const nameInputEl = document.getElementById("name-input");
const nameSubmitEl = document.getElementById("name-submit");
const nameErrorEl = document.getElementById("name-error");

function showModal() {
  nameModalEl.classList.remove('hidden');
  nameModalEl.classList.add('flex');
  nameInputEl.focus();
}

function hideModal() {
  nameModalEl.classList.add('hidden');
  nameModalEl.classList.remove('flex');
  isLoggedIn = true;
}

nameSubmitEl.addEventListener("click", submitUsername);
nameInputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    submitUsername();
  }
});

function submitUsername() {
  const name = (nameInputEl.value || "").trim();
  if (!name) {
    showNameError("Please enter a nickname.");
    return;
  }
  fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: name })
  })
    .then(res => {
      if (!res.ok) return res.json().then(err => { throw new Error(err.error) });
      return res.json();
    })
    .then(data => {
      socket.disconnect().connect();
    })
    .catch(err => {
      showNameError(err.message || "Login failed");
    });
}

function showNameError(msg) {
  nameErrorEl.textContent = msg;
  nameErrorEl.classList.remove("hidden");
  setTimeout(() => nameErrorEl.classList.add("hidden"), 3000);
}

socket.on("auto_login", ({ username }) => {
  myUsername = username;
  myUsernameBadgeEl.textContent = username;
  isLoggedIn = true;
  hideModal();
});

socket.on("request_login", () => {
  showModal();
});

socket.on("user_list", ({ users }) => {
  drawUserList(users);
});

socket.on("user_left", ({ username }) => {
  if (activeRecipient === username) {
    backToUserList();
  }
});

socket.on("receive_message", (payload) => {
  const { from, to, text, time } = payload;
  const otherParty = (from === myUsername) ? to : from;

  if (!conversations[otherParty]) conversations[otherParty] = [];
  conversations[otherParty].push({ from, to, text, time });

  if (activeRecipient === otherParty) {
    appendMessage(payload);
    scrollChatToBottom();
  } else {
    unreadCounts[otherParty] = (unreadCounts[otherParty] || 0) + 1;
    drawUserList();
  }
});

socket.on("typing", ({ from, is_typing }) => {
  if (activeRecipient === from) {
    showTyping(is_typing, from);
  }
});

socket.on("logout_ok", () => {
  isLoggedIn = false;
  myUsername = null;
  location.reload();
});

backBtnEl.addEventListener("click", backToUserList);

logoutBtnEl.addEventListener("click", () => {
  if (confirm("Are you sure you want to logout?")) {

    fetch('/api/logout', { method: 'POST' })
      .then(() => {
        socket.emit("logout");
        location.reload();
      })
      .catch(err => {
        location.reload();
      });
  }
});

searchUsersEl.addEventListener("input", (e) => {
  const query = e.target.value.toLowerCase();
  const userButtons = userListEl.querySelectorAll("[data-username]");
  userButtons.forEach(btn => {
    const username = btn.dataset.username.toLowerCase();
    btn.style.display = username.includes(query) ? "" : "none";
  });
});

sendBtnEl.addEventListener("click", sendMessage);
msgInputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  } else if (event.key !== "Enter" && activeRecipient) {
    socket.emit("typing", { to: activeRecipient, is_typing: true });
    debounceStopTyping();
  }
});

function sendMessage() {
  const text = (msgInputEl.value || "").trim();
  if (!text || !activeRecipient) return;
  socket.emit("private_message", {
    to: activeRecipient,
    text: text
  });
  msgInputEl.value = "";
}

function drawUserList(users = null) {
  const myNameLower = (myUsername || "").toLowerCase();

  if (users) {
    const filteredUsers = users.filter(u => u.toLowerCase() !== myNameLower);

    if (filteredUsers.length === 0) {
      userListEl.innerHTML = `
        <div class="p-8 text-center text-gray-400 text-sm">
          <span class="material-symbols-outlined text-4xl mb-2 opacity-50">person_search</span>
          <p>No users online</p>
        </div>
      `;
      return;
    }

    userListEl.innerHTML = "";
    filteredUsers.forEach(u => {
      const unread = unreadCounts[u] || 0;
      const lastMsg = conversations[u]?.[conversations[u].length - 1];
      const lastMsgText = lastMsg ? lastMsg.text : "Start a conversation";
      const lastMsgTime = lastMsg ? lastMsg.time : "";

      const btn = document.createElement("button");
      btn.className = "w-full flex items-center gap-3 px-4 py-3 hover:bg-border-dark transition-colors border-b border-border-dark";
      btn.dataset.username = u;

      btn.innerHTML = `
        <div class="relative">
          <div class="w-12 h-12 rounded-full bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center shadow-md flex-shrink-0">
            <span class="material-symbols-outlined text-white text-[20px]">person</span>
          </div>
          <span class="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-green-500 border-2 border-surface-dark"></span>
        </div>
        <div class="flex-1 min-w-0 text-left">
          <div class="flex items-center justify-between mb-1">
            <h3 class="font-semibold text-sm truncate">${escapeHTML(u)}</h3>
            ${lastMsgTime ? `<span class="text-xs text-gray-500 flex-shrink-0">${lastMsgTime}</span>` : ''}
          </div>
          <p class="text-xs text-gray-400 truncate">${escapeHTML(lastMsgText)}</p>
        </div>
        ${unread > 0 ? `<div class="flex-shrink-0 w-5 h-5 rounded-full bg-primary text-white text-xs flex items-center justify-center font-bold">${unread}</div>` : ''}
      `;

      btn.onclick = () => selectRecipient(u);
      userListEl.appendChild(btn);
    });
  }
}

function selectRecipient(username) {
  activeRecipient = username;
  chatUsernameEl.textContent = username;
  unreadCounts[username] = 0;

  if (window.innerWidth < 768) {
    usersViewEl.classList.add('hidden');
    chatViewEl.classList.remove('hidden');
    chatViewEl.classList.add('flex');
  }

  emptyStateEl.classList.add('hidden');
  chatHeaderEl.classList.remove('hidden');
  chatHeaderEl.classList.add('flex');
  messagesScrollEl.classList.remove('hidden');
  inputAreaEl.classList.remove('hidden');

  chatContainerEl.innerHTML = "";
  const history = conversations[username] || [];
  history.forEach(msg => appendMessage(msg));
  scrollChatToBottom();

  drawUserList();
}

function backToUserList() {
  activeRecipient = null;

  if (window.innerWidth < 768) {
    usersViewEl.classList.remove('hidden');
    chatViewEl.classList.add('hidden');
  }

  chatHeaderEl.classList.add('hidden');
  messagesScrollEl.classList.add('hidden');
  inputAreaEl.classList.add('hidden');
  emptyStateEl.classList.remove('hidden');
  chatContainerEl.innerHTML = "";
}

function appendMessage({ from, to, text, time }) {
  const isMine = (from === myUsername);
  const msgDiv = document.createElement('div');
  if (isMine) {
    msg_style = "bg-primary text-white rounded-2xl rounded-tr-sm"
  }
  if (!isMine) {
    msg_style = "bg-surface-dark border border-border-dark rounded-2xl rounded-tl-sm"
  }
  if (isSingleEmoji(text)) {
    msg_style = "!bg-transparent !border-none !shadow-none !p-0 [&_p]:!text-4xl"
  }
  msgDiv.className = `flex gap-2 ${isMine ? 'flex-row-reverse' : ''} animate-fadeIn`;
  msgDiv.innerHTML = `
    <div class="flex-shrink-0">
      <div class="w-8 h-8 rounded-full bg-gradient-to-br ${isMine ? 'from-primary to-blue-600' : 'from-purple-500 to-pink-500'} flex items-center justify-center shadow-md">
        <span class="material-symbols-outlined text-white text-[16px]">person</span>
      </div>
    </div>
    <div class="flex flex-col gap-1 max-w-[75%] md:max-w-[60%]">
      <div class="${msg_style} px-4 py-2.5 shadow-sm">
        <p class="text-sm leading-relaxed break-words">${escapeHTML(text)}</p>
      </div>
      <span class="text-xs text-gray-400 ${isMine ? 'text-right' : 'text-left'} px-1">${time || ''}</span>
    </div>
  `;

  chatContainerEl.appendChild(msgDiv);
}

function scrollChatToBottom() {
  setTimeout(() => {
    messagesScrollEl.scrollTop = messagesScrollEl.scrollHeight;
  }, 100);
}

function isSingleEmoji(str) {
  if (typeof str !== "string") return false;

  const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
  const segments = [...segmenter.segment(str)];

  return (
    segments.length === 1 &&
    /\p{Extended_Pictographic}/u.test(segments[0].segment)
  );
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

let typingTimeout = null;
function debounceStopTyping() {
  if (typingTimeout) clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    if (activeRecipient) socket.emit("typing", { to: activeRecipient, is_typing: false });
  }, 1000);
}

function showTyping(show, username) {
  if (show) {
    typingIndicatorEl.textContent = `${username} is typing...`;
    typingIndicatorEl.classList.remove('hidden');
  } else {
    typingIndicatorEl.classList.add('hidden');
  }
}

window.addEventListener('resize', () => {
  if (window.innerWidth >= 768) {
    usersViewEl.classList.remove('hidden');
    if (activeRecipient) {
      chatViewEl.classList.remove('hidden');
      chatViewEl.classList.add('flex');
    }
  }
});