(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const els = {
    account: $("#account-button"),
    authBackdrop: $("#auth-backdrop"),
    authForm: $("#auth-form"),
    authTitle: $("#auth-title"),
    authSubmit: $("#auth-submit"),
    authMode: $("#auth-mode"),
    authError: $("#auth-error"),
    closeAuth: $("#close-auth"),
    projectUrl: $("#project-url"),
    anonKey: $("#anon-key"),
    email: $("#email"),
    password: $("#password"),
    connection: $("#connection-status"),
    composer: $("#composer"),
    input: $("#message-input"),
    send: $("#send-button"),
    mic: $("#mic-button"),
    messages: $("#messages"),
    empty: $("#empty-state"),
    typing: $("#typing-indicator"),
    composerStatus: $("#composer-status"),
    composerMeta: $(".composer-meta"),
    clear: $("#clear-button"),
    speak: $("#speak-toggle"),
    install: $("#install-button"),
    toast: $("#toast"),
    prompts: $(".quick-prompts")
  };

  const CONFIG_KEY = "jarvis.supabase.config";
  const HISTORY_PREFIX = "jarvis.chat.";
  const VOICE_KEY = "jarvis.voice.enabled";
  const MAX_HISTORY = 100;
  const REQUEST_HISTORY = 20;
  let supabase = null;
  let session = null;
  let history = [];
  let creatingAccount = false;
  let pendingInstall = null;
  let recognition = null;
  let toastTimer = 0;
  let busy = false;
  let voiceEnabled = localStorage.getItem(VOICE_KEY) !== "false";

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { els.toast.hidden = true; }, 4200);
  }

  function showAuth(message = "") {
    els.authError.textContent = message;
    els.authError.hidden = !message;
    els.authBackdrop.hidden = false;
    document.body.classList.add("auth-open");
    if (!session) {
      els.input.disabled = true;
      els.send.disabled = true;
      els.composerStatus.textContent = "SIGN IN TO BEGIN";
    }
  }

  function hideAuth() {
    els.authBackdrop.hidden = true;
    document.body.classList.remove("auth-open");
  }

  function updateAuthMode() {
    els.authTitle.innerHTML = creatingAccount
      ? "Create your<br><span>secure account.</span>"
      : "Connect to<br><span>your intelligence.</span>";
    els.authSubmit.innerHTML = creatingAccount
      ? 'CREATE ACCOUNT <span>→</span>'
      : 'SIGN IN <span>→</span>';
    els.authMode.innerHTML = creatingAccount
      ? 'Already have an account? <strong>Sign in</strong>'
      : 'New here? <strong>Create an account</strong>';
    els.password.autocomplete = creatingAccount ? "new-password" : "current-password";
  }

  function setConnected(isConnected) {
    els.connection.classList.toggle("is-online", isConnected);
    els.connection.querySelector("span").textContent = isConnected ? "CONNECTED" : "OFFLINE";
    els.account.textContent = isConnected ? "↗" : "···";
    els.account.setAttribute("aria-label", isConnected ? "Sign out" : "Sign in");
    els.input.disabled = !isConnected || busy;
    els.send.disabled = !isConnected || busy || !els.input.value.trim();
    els.composerStatus.textContent = isConnected ? "SECURE SESSION ACTIVE" : "SIGN IN TO BEGIN";
    els.composerMeta.classList.toggle("is-ready", isConnected);
    els.clear.hidden = !isConnected || history.length === 0;
    els.speak.disabled = !isConnected;
  }

  function createClient(url, key) {
    if (!window.supabase?.createClient) {
      throw new Error("The Supabase client could not load. Check your internet connection and reload.");
    }
    return window.supabase.createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
  }

  function validateProjectUrl(value) {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error("Enter a valid Supabase Project URL.");
    }
    const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if ((!isLocal && parsed.protocol !== "https:") || (isLocal && !["http:", "https:"].includes(parsed.protocol))) {
      throw new Error("Your Supabase Project URL must use HTTPS.");
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== "/" && parsed.pathname !== "")) {
      throw new Error("Enter the project base URL only, such as https://your-project.supabase.co.");
    }
    return parsed.origin;
  }

  function saveConfig(url, key) {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify({ url, key }));
    } catch (error) {
      throw new Error(`Could not save your project settings in this browser: ${error.message}`);
    }
  }

  function historyKey(userId) {
    return `${HISTORY_PREFIX}${userId}`;
  }

  function loadHistory(userId) {
    try {
      const saved = JSON.parse(localStorage.getItem(historyKey(userId)) || "[]");
      history = Array.isArray(saved)
        ? saved.filter((item) => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string").slice(-MAX_HISTORY)
        : [];
    } catch (error) {
      history = [];
      showToast(`Could not read saved conversation history: ${error.message}`);
    }
    renderHistory();
  }

  function persistHistory() {
    if (!session) return;
    try {
      localStorage.setItem(historyKey(session.user.id), JSON.stringify(history.slice(-MAX_HISTORY)));
    } catch (error) {
      showToast(`Could not save chat history on this device: ${error.message}`);
    }
    els.clear.hidden = history.length === 0;
  }

  function formatTime(iso) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function addMessageElement(item) {
    const entry = document.createElement("article");
    entry.className = `message ${item.role}`;
    const label = document.createElement("span");
    label.className = "message-label";
    label.textContent = item.role === "user" ? "YOU" : "JARVIS";
    const bubble = document.createElement("p");
    bubble.className = "message-bubble";
    bubble.textContent = item.content;
    const time = document.createElement("div");
    time.className = "message-time";
    time.textContent = formatTime(item.createdAt);
    entry.append(label, bubble, time);
    els.messages.append(entry);
  }

  function renderHistory() {
    els.messages.replaceChildren();
    history.forEach(addMessageElement);
    els.empty.hidden = history.length > 0;
    els.clear.hidden = !session || history.length === 0;
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  function addMessage(role, content) {
    const item = { role, content, createdAt: new Date().toISOString() };
    history.push(item);
    if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
    addMessageElement(item);
    els.empty.hidden = true;
    els.messages.scrollTop = els.messages.scrollHeight;
    persistHistory();
    return item;
  }

  function extractReply(data) {
    if (typeof data === "string" && data.trim()) return data.trim();
    if (!data || typeof data !== "object") return "";
    const candidate = data.reply ?? data.answer ?? data.message ?? data.output ?? data.text
      ?? data.choices?.[0]?.message?.content;
    if (typeof candidate === "string") return candidate.trim();
    if (Array.isArray(candidate)) {
      return candidate.map((part) => typeof part === "string" ? part : part?.text || "").join("").trim();
    }
    return "";
  }

  async function errorMessage(error) {
    if (error?.context instanceof Response) {
      try {
        const body = await error.context.clone().json();
        return body.error || body.message || body.msg || error.message;
      } catch {
        try {
          const text = await error.context.clone().text();
          return text.slice(0, 300) || error.message;
        } catch { /* Use the SDK error below. */ }
      }
    }
    return error?.message || "The request could not be completed.";
  }

  function setBusy(value) {
    busy = value;
    els.typing.hidden = !value;
    els.input.disabled = !session || value;
    els.send.disabled = !session || value || !els.input.value.trim();
    els.prompts.querySelectorAll("button").forEach((button) => { button.disabled = value || !session; });
  }

  async function sendMessage(text) {
    const prompt = text.trim();
    if (!prompt || !session || busy) return;
    if (!supabase) {
      showToast("Supabase is not connected. Sign in again to continue.");
      return;
    }
    els.input.value = "";
    els.send.disabled = true;
    addMessage("user", prompt);
    setBusy(true);
    try {
      const messages = history.slice(-REQUEST_HISTORY).map(({ role, content }) => ({ role, content }));
      const { data, error } = await supabase.functions.invoke("jarvis-chat", {
        body: { messages },
        headers: { Authorization: `Bearer ${session.access_token}` }
      });
      if (error) throw new Error(await errorMessage(error));
      const reply = extractReply(data);
      if (!reply) throw new Error("The jarvis-chat function returned an empty or unsupported response. Check its response format.");
      addMessage("assistant", reply);
      if (voiceEnabled) speak(reply);
    } catch (error) {
      showToast(`JARVIS could not reply: ${error.message}`);
      addMessage("assistant", "I couldn’t reach the chat service just now. Please try again.");
    } finally {
      setBusy(false);
      els.input.focus({ preventScroll: true });
    }
  }

  function speak(text) {
    if (!("speechSynthesis" in window)) {
      showToast("Spoken replies are not supported in this browser.");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onerror = (event) => {
      if (event.error !== "canceled" && event.error !== "interrupted") showToast("The device could not play the spoken reply.");
    };
    window.speechSynthesis.speak(utterance);
  }

  function setupRecognition() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      els.mic.disabled = true;
      els.mic.title = "Voice input is not supported in this browser";
      return;
    }
    recognition = new Recognition();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      els.mic.classList.add("is-listening");
      els.mic.setAttribute("aria-label", "Stop voice input");
      els.composerStatus.textContent = "LISTENING";
    };
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim();
      if (transcript) {
        els.input.value = transcript;
        els.send.disabled = !session || busy || !transcript;
        sendMessage(transcript);
      }
    };
    recognition.onerror = (event) => {
      if (event.error !== "aborted" && event.error !== "no-speech") {
        showToast(event.error === "not-allowed" ? "Allow microphone access in your browser settings to use voice input." : `Voice input failed: ${event.error}.`);
      }
    };
    recognition.onend = () => {
      els.mic.classList.remove("is-listening");
      els.mic.setAttribute("aria-label", "Start voice input");
      if (session) els.composerStatus.textContent = "SECURE SESSION ACTIVE";
    };
  }

  async function applySession(nextSession) {
    session = nextSession;
    if (session) {
      loadHistory(session.user.id);
      setConnected(true);
      hideAuth();
      els.account.textContent = "↗";
      els.account.setAttribute("aria-label", "Sign out");
    } else {
      history = [];
      renderHistory();
      setConnected(false);
      if (!els.authBackdrop.hidden) return;
      showAuth();
    }
  }

  async function initialize() {
    els.speak.setAttribute("aria-pressed", String(voiceEnabled));
    els.speak.textContent = voiceEnabled ? "VOICE ON" : "VOICE OFF";
    setupRecognition();
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || "null");
      if (saved?.url && saved?.key) {
        els.projectUrl.value = saved.url;
        els.anonKey.value = saved.key;
        supabase = createClient(saved.url, saved.key);
        supabase.auth.onAuthStateChange((_event, nextSession) => {
          void applySession(nextSession);
        });
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (data.session) {
          await applySession(data.session);
          return;
        }
      }
    } catch (error) {
      showAuth(error.message || "Could not restore the previous sign-in.");
    }
    showAuth();
  }

  els.authMode.addEventListener("click", () => {
    creatingAccount = !creatingAccount;
    updateAuthMode();
    els.authError.hidden = true;
  });

  els.authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    els.authError.hidden = true;
    els.authSubmit.disabled = true;
    els.authSubmit.textContent = creatingAccount ? "CREATING ACCOUNT..." : "CONNECTING...";
    try {
      const url = validateProjectUrl(els.projectUrl.value.trim());
      const key = els.anonKey.value.trim();
      const email = els.email.value.trim();
      const password = els.password.value;
      if (!key) throw new Error("Enter your Supabase publishable or anon key.");
      saveConfig(url, key);
      if (!supabase || supabase.supabaseUrl !== url) {
        supabase = createClient(url, key);
        supabase.auth.onAuthStateChange((_event, nextSession) => {
          void applySession(nextSession);
        });
      }
      const result = creatingAccount
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (result.data.session) {
        await applySession(result.data.session);
        els.password.value = "";
        showToast(creatingAccount ? "Your account is ready." : "Securely connected to your JARVIS.");
      } else if (creatingAccount) {
        showToast("Check your email to confirm your account, then sign in.");
        creatingAccount = false;
        updateAuthMode();
      } else {
        throw new Error("Sign-in completed without an active session. Check your project’s email confirmation settings.");
      }
    } catch (error) {
      showAuth(error.message || "Authentication failed. Check your project settings and try again.");
    } finally {
      els.authSubmit.disabled = false;
      updateAuthMode();
    }
  });

  els.closeAuth.addEventListener("click", () => {
    if (session) hideAuth();
  });

  els.authBackdrop.addEventListener("click", (event) => {
    if (event.target === els.authBackdrop && session) hideAuth();
  });

  els.account.addEventListener("click", async () => {
    if (!session) {
      showAuth();
      return;
    }
    const { error } = await supabase.auth.signOut();
    if (error) {
      showToast(`Could not sign out: ${error.message}`);
      return;
    }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    showToast("You’ve been signed out.");
  });

  els.composer.addEventListener("submit", (event) => {
    event.preventDefault();
    void sendMessage(els.input.value);
  });
  els.input.addEventListener("input", () => {
    els.send.disabled = !session || busy || !els.input.value.trim();
  });

  els.prompts.addEventListener("click", (event) => {
    const button = event.target.closest("[data-prompt]");
    if (button && session && !busy) void sendMessage(button.dataset.prompt);
    else if (!session) showAuth();
  });

  els.mic.addEventListener("click", () => {
    if (!session) {
      showAuth();
      return;
    }
    if (!recognition) {
      showToast("Voice input is not supported here. You can still type a message.");
      return;
    }
    if (els.mic.classList.contains("is-listening")) recognition.stop();
    else {
      try { recognition.start(); }
      catch (error) { showToast(`Could not start voice input: ${error.message}`); }
    }
  });

  els.clear.addEventListener("click", () => {
    if (!session || history.length === 0) return;
    history = [];
    persistHistory();
    renderHistory();
    showToast("Conversation cleared from this device.");
  });

  els.speak.addEventListener("click", () => {
    voiceEnabled = !voiceEnabled;
    try {
      localStorage.setItem(VOICE_KEY, String(voiceEnabled));
    } catch (error) {
      showToast(`Could not save voice preference: ${error.message}`);
    }
    els.speak.setAttribute("aria-pressed", String(voiceEnabled));
    els.speak.textContent = voiceEnabled ? "VOICE ON" : "VOICE OFF";
    if (!voiceEnabled && "speechSynthesis" in window) window.speechSynthesis.cancel();
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    pendingInstall = event;
    els.install.hidden = false;
  });
  els.install.addEventListener("click", async () => {
    if (!pendingInstall) return;
    pendingInstall.prompt();
    await pendingInstall.userChoice;
    pendingInstall = null;
    els.install.hidden = true;
  });
  window.addEventListener("appinstalled", () => {
    els.install.hidden = true;
    showToast("JARVIS was added to your Home Screen.");
  });

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch((error) => {
        showToast(`Offline support could not start: ${error.message}`);
      });
    });
  }

  updateAuthMode();
  void initialize();
})();
