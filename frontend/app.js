// Minimal chat UI — POSTs to /chat, persists session_id in localStorage.

const $ = (sel) => document.querySelector(sel);
const messagesEl = $("#messages");
const inputEl = $("#input");
const sendBtn = $("#send");
const forceSearch = $("#force-search");
const clearBtn = $("#clear");
const modelPill = $("#model");
const searxPill = $("#searx");
const ollamaPill = $("#ollama");

const SESSION_KEY = "localai.session_id";
let sessionId = localStorage.getItem(SESSION_KEY) || null;

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function addMessage(role, text, extras = {}) {
  const wrap = document.createElement("div");
  wrap.className = `msg ${role}`;
  wrap.innerHTML = escapeHtml(text);

  const tags = [];
  if (extras.usedSearch) tags.push(`<span class="tag">web</span>`);
  if (extras.redactions && extras.redactions.length) {
    tags.push(`<span class="tag warn">redacted: ${extras.redactions.join(", ")}</span>`);
  }
  if (tags.length) {
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = tags.join("");
    wrap.appendChild(meta);
  }

  if (extras.sources && extras.sources.length) {
    const list = document.createElement("div");
    list.className = "sources";
    extras.sources.forEach((s, i) => {
      const a = document.createElement("a");
      a.href = s.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = `[${i + 1}] ${s.title || s.url}`;
      list.appendChild(a);
    });
    wrap.appendChild(list);
  }

  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return wrap;
}

function addSystem(text) {
  const wrap = document.createElement("div");
  wrap.className = "msg sys";
  wrap.textContent = text;
  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function checkHealth() {
  try {
    const r = await fetch("/health");
    if (!r.ok) throw new Error(`status ${r.status}`);
    const j = await r.json();
    modelPill.textContent = j.model || "model";
    ollamaPill.textContent = "llm";
    ollamaPill.className = `pill ${j.llm || j.ollama ? "ok" : "bad"}`;
    searxPill.textContent = "search";
    searxPill.className = `pill ${j.searxng ? "ok" : "bad"}`;
  } catch (e) {
    ollamaPill.className = "pill bad";
    searxPill.className = "pill bad";
    addSystem(`health check failed: ${e.message}`);
  }
}

async function loadHistory() {
  if (!sessionId) return;
  try {
    const r = await fetch(`/history/${encodeURIComponent(sessionId)}?limit=50`);
    if (!r.ok) return;
    const j = await r.json();
    j.messages.forEach((m) =>
      addMessage(m.role === "assistant" ? "bot" : m.role === "user" ? "user" : "sys", m.content)
    );
  } catch {}
}

async function send() {
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = "";
  inputEl.style.height = "auto";
  addMessage("user", text);
  sendBtn.disabled = true;
  const thinking = addMessage("bot", "…");
  try {
    const r = await fetch("/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: text,
        session_id: sessionId,
        force_search: forceSearch.checked || null,
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
    sessionId = j.session_id;
    localStorage.setItem(SESSION_KEY, sessionId);
    thinking.remove();
    addMessage("bot", j.answer, {
      usedSearch: j.used_search,
      sources: j.sources,
      redactions: j.redactions,
    });
  } catch (e) {
    thinking.remove();
    addSystem(`error: ${e.message}`);
  } finally {
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

async function clearHistory() {
  if (!sessionId) {
    messagesEl.innerHTML = "";
    return;
  }
  if (!confirm("Delete all local chat history for this session?")) return;
  try {
    await fetch(`/history/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  } catch {}
  localStorage.removeItem(SESSION_KEY);
  sessionId = null;
  messagesEl.innerHTML = "";
  addSystem("history cleared");
}

inputEl.addEventListener("input", () => {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, window.innerHeight * 0.3) + "px";
});

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});

sendBtn.addEventListener("click", send);
clearBtn.addEventListener("click", clearHistory);

checkHealth();
loadHistory();
setInterval(checkHealth, 15000);
