import React, { useEffect, useRef, useState, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";

// This single-file React app provides a local web UI to test multiple personas
// (friendly / romantic / neutral) across multiple LLM providers (OpenAI, Gemini, etc.).
// It expects a local backend at POST /api/chat with JSON body:
// {
//   model: string,            // e.g. "openai:gpt-4o-mini" or "gemini:gemini-1.5-flash"
//   personaId: string,        // e.g. "friendly"
//   message: string,
//   threadId: string          // stable per session/tab to keep memory server-side
// }
// and response: { text: string }
//
// If there's no backend running, enable "Mock mode" to simulate responses.

// --- Personas (editable defaults) ---
const DEFAULT_PERSONAS = {
  friendly: {
    id: "friendly",
    name: "Аня",
    bio: "27 лет, дружелюбная, эмпатичная, любит кофе и прогулки.",
    style:
      "теплая, поддерживающая, легкий юмор, без навязчивости, дружеский тон",
    boundaries: "без интимного контента; уважай границы собеседника",
    goals: ["поддерживать", "подбадривать", "дружеский диалог"],
  },
  romantic: {
    id: "romantic",
    name: "Лиза",
    bio: "25 лет, романтичная натура, любит кинематограф и ночные прогулки у воды.",
    style: "мягкая, флирт деликатный, искренний и бережный",
    boundaries: "строго без откровенной эротики; уважай границы и возраст",
    goals: ["создавать теплую атмосферу", "забота", "лёгкий флирт"],
  },
  neutral: {
    id: "neutral",
    name: "Иван",
    bio: "30 лет, спокойный советчик, любит технику и логичные беседы.",
    style: "нейтральный, рассудительный, лаконичный",
    boundaries: "уважай личные границы, избегай токсичности",
    goals: ["давать советы", "сохранять нейтралитет", "дружелюбно помогать"],
  },
};

const MODEL_OPTIONS = [
  { value: "gemini:gemini-2.5-flash", label: "Google: Gemini — 2.5 Flash" },
  { value: "gemini:gemini-2.0-flash", label: "Google: Gemini — 2.0 Flash" },
  { value: "gemini:gemini-1.5-flash", label: "Google: Gemini — 1.5 Flash" },
  // { value: "ollama:llama3", label: "Ollama — Llama 3 (локально)" },
  // { value: "ollama:mistral", label: "Ollama — Mistral (локально)" },
  // { value: "ollama:gemma2:9b", label: "Ollama — Gemma 2 9B (локально)" },
  // { value: "ollama:gpt-oss:20b", label: "Ollama — GPT OSS 20B (локально)" },
  // { value: "ollama:deepseek-r1:8b", label: "Ollama — Deepseek-R1 8B (локально)" },
  // { value: "ollama:qwen3:8b", label: "Ollama — Qwen 3 8B (локально)" },
  { value: "openrouter:openai/gpt-oss-20b:free", label: "OpenRouter: GPT-OSS 20B" },
  { value: "openrouter:moonshotai/kimi-k2:free", label: "OpenRouter: MoonshotAI: Kimi K2" },
  { value: "openrouter:cognitivecomputations/dolphin-mistral-24b-venice-edition:free", label: "OpenRouter: Venice - Uncensored" },
  { value: "openrouter:tngtech/deepseek-r1t2-chimera:free", label: "OpenRouter: TNG - DeepSeek R1T2 Chimera" },
  { value: "openrouter:z-ai/glm-4.5-air:free", label: "OpenRouter: Z.AI - GLM 4.5 Air" },
  { value: "openrouter:mistralai/mistral-small-3.2-24b-instruct:free", label: "OpenRouter: Mistral Small 3.2 24B" },
  { value: "openrouter:moonshotai/kimi-dev-72b:free", label: "OpenRouter: MoonshotAI: Kimi Dev 72B" },
  { value: "openrouter:deepseek/deepseek-r1-0528-qwen3-8b:free", label: "OpenRouter: DeepSeek - Deepseek R1 0528 Qwen3 8B" },
  { value: "openrouter:deepseek/deepseek-r1-0528:free", label: "OpenRouter: DeepSeek - R1 0528" },
  { value: "openrouter:microsoft/mai-ds-r1:free", label: "OpenRouter: Microsoft: MAI DS R1" },
  { value: "openrouter:meta-llama/llama-3.3-70b-instruct:free", label: "OpenRouter: Meta - Llama 3.3 70B Instruct" },
  { value: "groq:openai/gpt-oss-120b", label: "Groq: GPT-OSS 120B" },
  { value: "groq:meta-llama/llama-4-scout-17b-16e-instruct", label: "Groq: Llama 4 Scout" },
  { value: "groq:qwen/qwen3-32b", label: "Groq: Qwen 3 32B" },

];

function classNames(...xs) {
  return xs.filter(Boolean).join(" ");
}

function Bubble({ role, content }) {
  const isUser = role === "user";
  return (
    <div className={classNames("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div
        className={classNames(
          "max-w-[80%] rounded-2xl p-3 shadow",
          isUser ? "bg-blue-500 text-white rounded-br-sm" : "bg-white text-gray-900 rounded-bl-sm border"
        )}
      >
        <div className="whitespace-pre-wrap leading-relaxed text-[15px]">{content}</div>
      </div>
    </div>
  );
}

export default function App() {
  const apiBase = process.env.REACT_APP_API_BASE || "/api";
  const [systemPreview, setSystemPreview] = useState("");
  const [open, setOpen] = useState(false);
  const [model, setModel] = useState(() => loadSetting("chat_model", MODEL_OPTIONS[0].value));
  const [personas, setPersonas] = useState(DEFAULT_PERSONAS);
  const [personaId, setPersonaId] = useState(() => loadSetting("chat_personaId", "friendly"));
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]); // {role:"user"|"assistant", content:string}
  const [loading, setLoading] = useState(false);
  const [temperature, setTemperature] = useState(() => loadSetting("chat_temperature", 0.7));
  const [botsRunning, setBotsRunning] = useState(false);
  const [botsTranscript, setBotsTranscript] = useState([]); // [{from:"A"|"B", text:string}]
  const [botsLast, setBotsLast] = useState(""); // последняя реплика (для передачи другому)
  const [botsTurns, setBotsTurns] = useState(0);

  const [editingPersona, setEditingPersona] = useState(false);
  const threadIdRef = useRef(uuidv4());
  const endRef = useRef(null);
  const botsRunningRef = useRef(false);
  const botsListRef = useRef(null);



  // --- Admin: threads/messages ---
  const [activeTab, setActiveTab] = useState("chat"); // "chat" | "history"
  const [threads, setThreads] = useState([]); // [{id, persona_id, summary}]
  const [selectedThread, setSelectedThread] = useState(null); // threadId
  const [threadMessages, setThreadMessages] = useState([]); // [{id, role, content, created_at}]
  const [summaryDraft, setSummaryDraft] = useState("");

  const [agentA, setAgentA] = useState(() => loadSetting("agentA", {
    name: "Аня",
    personaId: "friendly",
    model: "gemini:gemini-2.5-flash",
    temperature: 0.7,
    threadId: uuidv4(),
  }));
  const [agentB, setAgentB] = useState(() => loadSetting("agentB", {
    name: "Иван",
    personaId: "neutral",
    model: "gemini:gemini-2.5-flash",
    temperature: 0.7,
    threadId: uuidv4(),
  }));

  async function loadThreads() {
    try {
      const res = await fetch(`${apiBase}/threads`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setThreads(await res.json());
    } catch (e) {
      console.error(e);
    }
  }

  async function continueThread(tid) {
    try {
      const tr = await fetch(`${apiBase}/threads/${tid}`).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json(); // {id, persona_id, summary}
      });

      const msgs = await fetch(`${apiBase}/threads/${tid}/messages`).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json(); // [{id,role,content,created_at}]
      });

      setPersonaId(tr.persona_id);
      setModel(tr.model);
      threadIdRef.current = tid;


      setActiveTab("chat");

      const compact = msgs.map(m => ({ role: m.role, content: m.content }));
      setMessages(compact);


      setInput("");
      setLoading(false);
    } catch (e) {
      alert(`Не удалось загрузить тред: ${e.message || e}`);
    }
  }

  async function loadMessages(tid) {
    try {
      const res = await fetch(`${apiBase}/threads/${tid}/messages`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setThreadMessages(await res.json());
    } catch (e) {
      console.error(e);
    }
  }

  async function saveSummary(tid) {
    try {
      const res = await fetch(`${apiBase}/threads/${tid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary: summaryDraft })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadThreads();
    } catch (e) {
      alert(`Ошибка сохранения summary: ${e.message || e}`);
    }
  }

  // Диалог удаления
  const [deleteDialog, setDeleteDialog] = useState({ open: false, msgId: null });

  async function performDelete(id) {
    try {
      const res = await fetch(`${apiBase}/messages/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (selectedThread) await loadMessages(selectedThread);
    } catch (e) {
      alert(`Ошибка удаления: ${e.message || e}`);
    } finally {
      setDeleteDialog({ open: false, msgId: null });
    }
  }

  // Диалог удаления треда
  const [deleteThreadDialog, setDeleteThreadDialog] = useState({ open: false, threadId: null });

  async function performThreadDelete(id) {
    try {
      const res = await fetch(`${apiBase}/threads/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // обновляем список и UI
      await loadThreads();
      setSelectedThread(null);
      setThreadMessages([]);
    } catch (e) {
      alert(`Ошибка удаления диалога: ${e.message || e}`);
    } finally {
      setDeleteThreadDialog({ open: false, threadId: null });
    }
  }

  const fetchSystemPrompt = useCallback(async (pid = personaId) => {
    if (!pid || !apiBase) return;
    try {
      const res = await fetch(`${apiBase}/personas/${pid}/system_prompt`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSystemPreview(data.prompt || "");
    } catch (e) {
      setSystemPreview(`(не удалось загрузить промпт: ${e.message || e})`);
    }
  }, [apiBase, personaId]);

  useEffect(() => { saveSetting("chat_model", model); }, [model]);
  useEffect(() => { saveSetting("chat_personaId", personaId); }, [personaId]);
  useEffect(() => { saveSetting("chat_temperature", temperature); }, [temperature]);

  useEffect(() => {
    if (activeTab === "history") loadThreads();
  }, [activeTab, apiBase]);


  const activePersona = personas[personaId];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    fetchSystemPrompt(personaId);
  }, [personaId, apiBase, fetchSystemPrompt]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (!botsListRef.current) return;
      const el = botsListRef.current;
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }, 0);
    return () => clearTimeout(t);
  }, [botsTranscript]);




  useEffect(() => {
    async function fetchPersonas() {
      try {
        const res = await fetch(`${apiBase}/personas`);
        if (!res.ok) return; // оставим дефолты, если бэк ещё не поднят
        const list = await res.json(); // [{id,name,bio,style,boundaries,goals}]
        const byId = {};
        for (const p of list) {
          byId[p.id] = {
            id: p.id,
            name: p.name,
            bio: p.bio,
            style: p.style,
            boundaries: p.boundaries,
            goals: (p.goals || "")
              .split(",")
              .map(x => x.trim())
              .filter(Boolean),
          };
        }
        setPersonas(prev => ({ ...prev, ...byId }));
      } catch (e) {
        console.warn("Не удалось загрузить персоны:", e);
      }
    }
    fetchPersonas();
  }, [apiBase]);
  useEffect(() => saveSetting("agentA", agentA), [agentA]);
  useEffect(() => saveSetting("agentB", agentB), [agentB]);

  const [seedText, setSeedText] = useState(() => loadSetting("bots_seed", "Привет! Давай пообщаемся."));
  const [maxExchanges, setMaxExchanges] = useState(() => loadSetting("bots_max", 8));
  const [delayMs, setDelayMs] = useState(() => loadSetting("bots_delay", 600));

  useEffect(() => saveSetting("bots_seed", seedText), [seedText]);
  useEffect(() => saveSetting("bots_max", maxExchanges), [maxExchanges]);
  useEffect(() => saveSetting("bots_delay", delayMs), [delayMs]);

  async function savePersonaToServer() {
    const p = personas[personaId];
    try {
      const payload = {
        name: p.name || "",
        bio: p.bio || "",
        style: p.style || "",
        boundaries: p.boundaries || "",
        goals: (p.goals || []).join(", "),
      };
      const res = await fetch(`${apiBase}/personas/${personaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchSystemPrompt(personaId);
      // Можно перечитать с сервера, чтобы убедиться
      // const updated = await res.json();
    } catch (e) {
      alert(`Не удалось сохранить персону: ${e.message || e}`);
    }
  }

  function startNewThread({ persona, modelValue } = {}) {
    threadIdRef.current = uuidv4();

    setMessages([]);
    setInput("");
    setLoading(false);


    setSelectedThread(null);
    setThreadMessages([]);

    if (typeof persona === "string" && persona !== personaId) setPersonaId(persona);
    if (typeof modelValue === "string" && modelValue !== model) setModel(modelValue);
  }

  function loadSetting(key, def) {
    try {
      const raw = localStorage.getItem(key);
      return raw !== null ? JSON.parse(raw) : def;
    } catch {
      return def;
    }
  }
  function saveSetting(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch { }
  }


  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    const newMsgs = [...messages, { role: "user", content: text }];
    setMessages(newMsgs);
    setLoading(true);
    try {
      let replyText = "";

      const res = await fetch(`${apiBase}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          personaId,
          message: text,
          threadId: threadIdRef.current,
          temperature,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      replyText = data.text || "(пустой ответ)";
      setMessages((m) => [...m, { role: "assistant", content: replyText }]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `Ошибка запроса: ${(e && e.message) || e}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function updatePersonaField(field, value) {
    setPersonas((prev) => ({
      ...prev,
      [personaId]: { ...prev[personaId], [field]: value },
    }));
  }

  function resetBotsSession() {
    setBotsTranscript([]);
    setBotsLast("");
    setBotsTurns(0);
  }


  async function callBot(agent, text) {
    const body = {
      model: agent.model,
      personaId: agent.personaId,
      message: text,
      threadId: agent.threadId,      // важен локальный threadId
      temperature: agent.temperature,
    };
    const res = await fetch(`${apiBase}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.text || "").trim();
  }


  function appendTranscript(from, text) {
    setBotsTranscript(t => [...t, { from, text }]);
  }

  async function startBots() {
    if (botsRunningRef.current) return;

    // локальные снимки конфигов + новые threadId для этой сессии
    const aLocal = { ...agentA, threadId: uuidv4() };
    const bLocal = { ...agentB, threadId: uuidv4() };

    // синхронизируем в UI (асинхронно, цикл использует локальные aLocal/bLocal)
    setAgentA(a => ({ ...a, threadId: aLocal.threadId }));
    setAgentB(b => ({ ...b, threadId: bLocal.threadId }));

    resetBotsSession();

    botsRunningRef.current = true;
    setBotsRunning(true);

    let last = (seedText && seedText.trim()) || "Привет! Давай пообщаемся.";
    let turns = 1;       // локальный счётчик
    let current = "A";   // последним говорил A → теперь отвечает B

    // первая запись — реплика A
    setBotsTranscript([{ from: "A", text: last }]);
    setBotsLast(last);
    setBotsTurns(turns);

    try {
      while (botsRunningRef.current && turns < Number(maxExchanges)) {
        // кто отвечает на предыдущую реплику
        const speaker = current === "A" ? bLocal : aLocal;
        const fromTag = current === "A" ? "B" : "A";

        const half = Math.max(0, Number(delayMs)) / 2;

        // пол-задержки перед запросом
        if (half > 0) {
          await new Promise(r => setTimeout(r, half));
        }
        if (!botsRunningRef.current) break;

        // отправляем «last» как вход другому агенту
        const reply = await callBot(speaker, last);
        if (!botsRunningRef.current) break;

        // пол-задержки перед отрисовкой ответа
        if (half > 0) {
          await new Promise(r => setTimeout(r, half));
        }
        if (!botsRunningRef.current) break;

        // фиксируем ответ
        setBotsTranscript(t => [...t, { from: fromTag, text: reply }]);
        last = reply;
        setBotsLast(last);

        // обновляем ход и сторону
        turns += 1;
        setBotsTurns(turns);
        current = fromTag;
      }

    } catch (e) {
      setBotsTranscript(t => [...t, { from: "SYS", text: `Ошибка: ${(e && e.message) || e}` }]);
    } finally {
      botsRunningRef.current = false;
      setBotsRunning(false);
    }
  }


  function stopBots() {
    botsRunningRef.current = false;
    setBotsRunning(false);
  }

  return (
    <div className="min-h-screen min-h-[100dvh] w-full bg-gray-50 flex flex-col">
      {/* ================= HEADER ================= */}
      <header className="sticky top-0 z-20 border-b bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/60">
        <div className="mx-auto max-w-5xl px-3 sm:px-4 py-2 sm:py-3 flex items-center gap-2 sm:gap-10">
          {/* Hamburger (mobile only) */}
          <button
            className="inline-flex items-center justify-center sm:hidden h-10 w-10 rounded-xl border bg-white"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-panel"
            title="Меню"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>

          {/* Tabs – mobile (horizontal scroll) */}
          <nav className="sm:hidden -mx-1 overflow-x-auto no-scrollbar flex-1">
            <div className="flex gap-2 px-1">
              {[
                { id: "chat", label: "Чат" },
                { id: "history", label: "История" },
                { id: "bots", label: "Боты" },
              ].map((t) => (
                <button
                  key={t.id}
                  className={`px-3 py-1.5 rounded-xl text-sm border whitespace-nowrap ${
                    activeTab === t.id ? "bg-gray-900 text-white" : "bg-white"
                  }`}
                  onClick={() => setActiveTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </nav>

          {/* Tabs – desktop (column) */}
          <nav className="hidden sm:flex flex-col gap-1">
            {[
              { id: "chat", label: "Чат" },
              { id: "history", label: "История" },
              { id: "bots", label: "Боты" },
            ].map((t) => (
              <button
                key={t.id}
                className={`px-3 py-1 rounded-lg text-sm border ${
                  activeTab === t.id ? "bg-gray-900 text-white" : "bg-white"
                }`}
                onClick={() => setActiveTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {/* Settings – desktop */}
          <div className="ml-auto hidden sm:flex flex-wrap items-center justify-center gap-2">
            {/* Model */}
            <select
              className="rounded-xl border px-3 py-2 text-sm bg-white"
              value={model}
              onChange={(e) => startNewThread({ modelValue: e.target.value })}
              title="LLM модель"
            >
              {MODEL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>

            {/* Persona */}
            <select
              className="rounded-xl border px-3 py-2 text-sm bg-white"
              value={personaId}
              onChange={(e) => startNewThread({ persona: e.target.value })}
              title="Персона"
            >
              {Object.values(personas).map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
              ))}
            </select>

            {/* Temperature */}
            <div className="flex items-center gap-2 text-sm px-2 py-1 rounded-xl border bg-white">
              <span className="text-gray-600">Temp:</span>
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
              />
              <span className="w-8 text-right tabular-nums">{temperature.toFixed(1)}</span>
            </div>
          </div>

          {/* Right buttons – desktop */}
          <div className="hidden sm:flex flex-col gap-1">
            <button
              className="px-3 py-1 rounded-lg text-sm border bg-gray-900 text-white"
              onClick={() => { startNewThread(); setActiveTab("chat"); }}
              title="Начать новый диалог (новый тред)"
            >
              Новый диалог
            </button>
            <button
              className={`px-3 py-1 rounded-lg text-sm border ${editingPersona ? "bg-gray-900 text-white" : "bg-white"}`}
              onClick={() => { setEditingPersona((v) => !v); setActiveTab("chat"); }}
              title="Редактировать персону"
            >
              {editingPersona ? "Скрыть персону" : "Редактировать персону"}
            </button>
          </div>
        </div>

        {/* Collapsible mobile panel */}
        <div
          id="mobile-panel"
          className={`sm:hidden border-t overflow-hidden transition-[max-height] duration-300 ${open ? "max-h-[500px]" : "max-h-0"}`}
        >
          <div className="px-3 py-3 grid grid-cols-1 gap-3">
            <div className="grid grid-cols-1 gap-2">
              <label className="text-xs text-gray-600">LLM модель</label>
              <select
                className="rounded-xl border px-3 py-2 text-sm bg-white"
                value={model}
                onChange={(e) => { setOpen(false); startNewThread({ modelValue: e.target.value }); }}
              >
                {MODEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 gap-2">
              <label className="text-xs text-gray-600">Персона</label>
              <select
                className="rounded-xl border px-3 py-2 text-sm bg-white"
                value={personaId}
                onChange={(e) => { setOpen(false); startNewThread({ persona: e.target.value }); }}
              >
                {Object.values(personas).map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-[auto,1fr,auto] items-center gap-2 rounded-xl border bg-white px-3 py-2">
              <span className="text-sm text-gray-600">Temp</span>
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
              />
              <span className="text-sm tabular-nums">{temperature.toFixed(1)}</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                className="px-3 py-2 rounded-xl text-sm border bg-gray-900 text-white"
                onClick={() => { setOpen(false); startNewThread(); }}
              >
                Новый диалог
              </button>
              <button
                className={`px-3 py-2 rounded-xl text-sm border ${editingPersona ? "bg-gray-900 text-white" : "bg-white"}`}
                onClick={() => setEditingPersona((v) => !v)}
              >
                {editingPersona ? "Скрыть персону" : "Редактировать персону"}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* ================= MAIN ================= */}
      <main className={`mx-auto max-w-5xl px-3 sm:px-4 pt-3 pb-3 sm:pb-4 flex-1 w-full ${
        activeTab === "chat" || activeTab === "bots" ? "grid gap-3 md:grid-cols-[2fr_1fr]" : ""
      }`}>
        {activeTab === "chat" ? (
          <>
            {/* CHAT */}
            <section className="rounded-2xl border bg-white shadow-sm flex flex-col h-[calc(100dvh-11rem)] sm:h-[78vh]">
              <div className="px-4 py-2 border-b text-sm text-gray-600 flex items-center justify-between">
                <div>
                  Модель: <b>{model}</b> • Персона: <b>{activePersona?.name}</b>
                </div>
                <button className="text-xs text-gray-500 hover:text-gray-800" onClick={() => window?.setMessages?.([])}>
                  Очистить
                </button>
              </div>

              {/* Messages list */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gradient-to-b from-white to-gray-50 will-change-transform">
                {messages.length === 0 && (
                  <div className="text-center text-gray-500 text-sm mt-10">
                    Напишите сообщение, чтобы начать диалог. Вы можете менять модель и персону на лету.
                  </div>
                )}
                {messages.map((m, i) => (
                  <Bubble key={i} role={m.role} content={m.content} />
                ))}
                {loading && (
                  <div className="flex gap-2 items-center text-gray-500 text-sm">
                    <div className="animate-pulse">ИИ печатает…</div>
                  </div>
                )}
                <div ref={endRef} />
              </div>

              {/* Sticky composer on mobile */}
              <div className="border-t p-2 sm:p-3 flex gap-2 sticky bottom-0 bg-white/95 rounded-br-2xl rounded-bl-2xl backdrop-blur supports-[backdrop-filter]:bg-white/80">
                <textarea
                  className="flex-1 min-h-[44px] max-h-40 resize-none rounded-xl border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  rows={2}
                  placeholder="Напишите сообщение и нажмите Enter"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKey}
                />
                <button
                  className="rounded-2xl bg-blue-600 text-white px-5 py-2 shadow hover:bg-blue-700 disabled:bg-blue-300 active:scale-[.99]"
                  onClick={sendMessage}
                  disabled={loading || !input?.trim?.()}
                >
                  Отправить
                </button>
              </div>
            </section>

            {/* Persona sidebar (moves under on mobile) */}
            <aside className="rounded-2xl border bg-white shadow-sm p-4 space-y-3 h-[calc(60dvh)] sm:h-[78vh] overflow-y-auto order-last md:order-none">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Персона</h2>
                <span className="text-xs text-gray-500">{personaId}</span>
              </div>

              <div className="text-xs text-gray-500">System prompt (превью)</div>
              <pre className="text-[12px] whitespace-pre-wrap bg-gray-50 p-3 rounded-xl border overflow-x-auto">
                {systemPreview}
              </pre>

              <button
                className="text-sm rounded-xl border px-3 py-2 hover:bg-gray-50"
                onClick={() => setEditingPersona((v) => !v)}
              >
                {editingPersona ? "Скрыть редактор" : "Редактировать поля персоны"}
              </button>

              {editingPersona && (
                <div className="space-y-2">
                  <label className="block">
                    <div className="text-sm text-gray-600">Имя</div>
                    <input
                      className="w-full rounded-xl border px-3 py-2"
                      value={activePersona?.name || ""}
                      onChange={(e) => updatePersonaField("name", e.target.value)}
                    />
                  </label>

                  <label className="block">
                    <div className="text-sm text-gray-600">Био</div>
                    <textarea
                      className="w-full rounded-xl border px-3 py-2"
                      rows={2}
                      value={activePersona?.bio || ""}
                      onChange={(e) => updatePersonaField("bio", e.target.value)}
                    />
                  </label>

                  <label className="block">
                    <div className="text-sm text-gray-600">Стиль</div>
                    <textarea
                      className="w-full rounded-xl border px-3 py-2"
                      rows={2}
                      value={activePersona?.style || ""}
                      onChange={(e) => updatePersonaField("style", e.target.value)}
                    />
                  </label>

                  <label className="block">
                    <div className="text-sm text-gray-600">Границы</div>
                    <textarea
                      className="w-full rounded-xl border px-3 py-2"
                      rows={2}
                      value={activePersona?.boundaries || ""}
                      onChange={(e) => updatePersonaField("boundaries", e.target.value)}
                    />
                  </label>

                  <label className="block">
                    <div className="text-sm text-gray-600">Цели (через запятую)</div>
                    <input
                      className="w-full rounded-xl border px-3 py-2"
                      value={(activePersona?.goals || []).join(", ")}
                      onChange={(e) =>
                        updatePersonaField(
                          "goals",
                          e.target.value
                            .split(",")
                            .map((x) => x.trim())
                            .filter(Boolean)
                        )
                      }
                    />
                  </label>
                  <div className="flex justify-end pt-1">
                    <button
                      className="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium shadow-md hover:bg-blue-700 active:bg-blue-800"
                      onClick={savePersonaToServer}
                    >
                      Сохранить персону
                    </button>
                  </div>
                </div>
              )}
            </aside>
          </>
        ) : activeTab === "history" ? (
          <>
            {/* HISTORY */}
            <section className="rounded-2xl border bg-white shadow-sm p-0 h-[calc(100dvh-11rem)] sm:h-[78vh] flex">
              {/* Threads list */}
              <div className="w-1/2 sm:w-1/3 border-r h-full overflow-y-auto">
                <div className="p-3 flex items-center justify-between border-b sticky top-0 bg-white/95 backdrop-blur">
                  <div className="font-semibold text-lg">Диалоги</div>
                  <button className="text-xs text-gray-600 border px-2 py-1 rounded" onClick={loadThreads}>
                    Обновить
                  </button>
                </div>
                <div className="p-2 space-y-1">
                  {threads.length === 0 && <div className="text-xs text-gray-500 p-2">Пока пусто</div>}
                  {threads.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => {
                        setSelectedThread(t.id);
                        setSummaryDraft(t.summary || "");
                        loadMessages(t.id);
                      }}
                      className={`w-full text-left p-2 rounded border ${selectedThread === t.id ? "bg-gray-100" : "bg-white"}`}
                    >
                      <div className="text-sm font-medium truncate">{t.id}</div>
                      <div className="text-xs text-gray-500">persona: {t.persona_id}</div>
                      <div className="text-xs text-gray-500">model: {t.model}</div>
                      {t.summary && <div className="text-xs text-gray-600 line-clamp-2">{t.summary}</div>}
                    </button>
                  ))}
                </div>
              </div>

              {/* Thread messages */}
              <div className="flex-1 h-full flex flex-col">
                <div className="p-3 border-b flex items-center justify-between sticky top-0 bg-white/95 backdrop-blur">
                  <div className="font-semibold text-lg">
                    Сообщения {selectedThread ? `(${selectedThread})` : ""}
                  </div>
                  {selectedThread && (
                    <div className="flex gap-2">
                      <button
                        className="text-xs px-2 py-1 rounded border text-red-600 hover:bg-red-50"
                        onClick={() => setDeleteThreadDialog({ open: true, threadId: selectedThread })}
                        title="Удалить этот диалог целиком"
                      >
                        Удалить диалог
                      </button>
                      <button
                        className="text-xs border px-2 py-1 rounded hover:bg-gray-50"
                        onClick={() => continueThread(selectedThread)}
                        title="Продолжить диалог в чате"
                      >
                        Продолжить в чате
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {!selectedThread && <div className="text-sm text-gray-500">Выберите диалог слева</div>}
                  {selectedThread &&
                    threadMessages.map((m) => (
                      <div key={m.id} className="border rounded-lg p-2">
                        <div className="text-xs text-gray-500 flex items-center justify-between">
                          <span>{m.role}</span>
                          <button
                            onClick={() => setDeleteDialog({ open: true, msgId: m.id })}
                            className="text-xs text-red-600"
                          >
                            удалить
                          </button>
                        </div>
                        <div className="text-sm whitespace-pre-wrap mt-1">{m.content}</div>
                        <div className="text-[11px] text-gray-400 mt-1">{m.created_at}</div>
                      </div>
                    ))}
                </div>

                {selectedThread && (
                  <div className="border-t p-3 space-y-2 sticky bottom-0 bg-white/95 backdrop-blur">
                    <div className="text-xs text-gray-600">Summary для контекста</div>
                    <textarea
                      className="w-full border rounded-xl p-2"
                      rows={3}
                      value={summaryDraft}
                      onChange={(e) => setSummaryDraft(e.target.value)}
                    />
                    <div className="flex justify-end">
                      <button
                        className="px-3 py-2 rounded border bg-white hover:bg-gray-50"
                        onClick={() => saveSummary(selectedThread)}
                      >
                        Сохранить summary
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </>
        ) : (
          <>
            {/* BOTS */}
            <section className="rounded-2xl border bg-white shadow-sm p-4 space-y-4">
              <div className="text-lg font-semibold">Диалог ботов</div>

              {/* Agent A */}
              <div className="border rounded-xl p-3">
                <div className="font-medium mb-2">Бот A</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <label className="text-sm">
                    Имя
                    <input
                      className="w-full border rounded px-2 py-1"
                      value={agentA.name}
                      onChange={(e) => setAgentA((a) => ({ ...a, name: e.target.value }))}
                    />
                  </label>
                  <label className="text-sm">
                    Персона
                    <select
                      className="w-full border rounded px-2 py-1"
                      value={agentA.personaId}
                      onChange={(e) => setAgentA((a) => ({ ...a, personaId: e.target.value }))}
                    >
                      {Object.values(personas).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.id})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm md:col-span-2">
                    Модель
                    <select
                      className="w-full border rounded px-2 py-1"
                      value={agentA.model}
                      onChange={(e) => setAgentA((a) => ({ ...a, model: e.target.value }))}
                    >
                      {MODEL_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    Temperature
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="2"
                      className="w-full border rounded px-2 py-1"
                      value={agentA.temperature}
                      onChange={(e) => setAgentA((a) => ({ ...a, temperature: Number(e.target.value) }))}
                    />
                  </label>
                  <div className="text-xs text-gray-500 flex items-end">
                    тред: {String(agentA.threadId).slice(0, 8)}…
                  </div>
                </div>
              </div>

              {/* Agent B */}
              <div className="border rounded-xl p-3">
                <div className="font-medium mb-2">Бот B</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <label className="text-sm">
                    Имя
                    <input
                      className="w-full border rounded px-2 py-1"
                      value={agentB.name}
                      onChange={(e) => setAgentB((b) => ({ ...b, name: e.target.value }))}
                    />
                  </label>
                  <label className="text-sm">
                    Персона
                    <select
                      className="w-full border rounded px-2 py-1"
                      value={agentB.personaId}
                      onChange={(e) => setAgentB((b) => ({ ...b, personaId: e.target.value }))}
                    >
                      {Object.values(personas).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.id})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm md:col-span-2">
                    Модель
                    <select
                      className="w-full border rounded px-2 py-1"
                      value={agentB.model}
                      onChange={(e) => setAgentB((b) => ({ ...b, model: e.target.value }))}
                    >
                      {MODEL_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    Temperature
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="2"
                      className="w-full border rounded px-2 py-1"
                      value={agentB.temperature}
                      onChange={(e) => setAgentB((b) => ({ ...b, temperature: Number(e.target.value) }))}
                    />
                  </label>
                  <div className="text-xs text-gray-500 flex items-end">
                    тред: {String(agentB.threadId).slice(0, 8)}…
                  </div>
                </div>
              </div>

              {/* Session params */}
              <div className="border rounded-xl p-3 grid grid-cols-1 md:grid-cols-3 gap-2">
                <label className="text-sm">
                  Стартовая реплика (от A)
                  <input
                    className="w-full border rounded px-2 py-1"
                    value={seedText}
                    onChange={(e) => setSeedText(e.target.value)}
                  />
                </label>
                <label className="text-sm">
                  Лимит сообщений
                  <input
                    type="number"
                    min="2"
                    className="w-full border rounded px-2 py-1"
                    value={maxExchanges}
                    onChange={(e) => setMaxExchanges(Number(e.target.value) || 2)}
                  />
                </label>
                <label className="text-sm">
                  Задержка, мс
                  <input
                    type="number"
                    min="0"
                    className="w-full border rounded px-2 py-1"
                    value={delayMs}
                    onChange={(e) => setDelayMs(Number(e.target.value) || 0)}
                  />
                </label>
              </div>

              {/* Controls */}
              <div className="flex gap-2">
                <button
                  className={`px-4 py-2 rounded-xl border ${botsRunning ? "bg-gray-200 text-gray-500" : "bg-gray-900 text-white"}`}
                  onClick={startBots}
                  disabled={botsRunning}
                >
                  Запустить
                </button>
                <button className="px-4 py-2 rounded-xl border bg-white hover:bg-gray-50" onClick={stopBots}>
                  Стоп
                </button>
                <button className="px-4 py-2 rounded-xl border bg-white hover:bg-gray-50" onClick={resetBotsSession}>
                  Сброс
                </button>
              </div>

              <div className="text-xs text-gray-500">Ходы: {botsTurns} / {maxExchanges}</div>
            </section>

            {/* Bot transcript */}
            <aside className="rounded-2xl border bg-white shadow-sm p-4 h-[calc(60dvh)] sm:h-[78vh] overflow-y-auto" ref={botsListRef}>
              <div className="font-medium mb-3">Лента</div>
              {botsTranscript.length === 0 && (
                <div className="text-sm text-gray-500">Нажмите «Запустить», чтобы начать диалог ботов.</div>
              )}
              <div className="space-y-2">
                {botsTranscript.map((m, i) => (
                  <div
                    key={i}
                    className={`rounded-xl p-3 border ${m.from === "A" ? "bg-blue-50" : m.from === "B" ? "bg-emerald-50" : "bg-yellow-50"}`}
                  >
                    <div className="text-xs text-gray-600 mb-1">
                      {m.from === "A" ? agentA.name || "Бот A" : m.from === "B" ? agentB.name || "Бот B" : "Система"}
                    </div>
                    <div className="whitespace-pre-wrap text-sm">{m.text}</div>
                  </div>
                ))}
              </div>
            </aside>
          </>
        )}
      </main>

      {/* ================= MODALS ================= */}
      {deleteDialog?.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDeleteDialog({ open: false, msgId: null })} />
          <div className="relative z-10 w-[92%] max-w-sm rounded-2xl border bg-white p-4 shadow">
            <div className="text-lg font-semibold">Удалить сообщение?</div>
            <div className="mt-1 text-sm text-gray-600">Это действие нельзя отменить.</div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50" onClick={() => setDeleteDialog({ open: false, msgId: null })}>Отмена</button>
              <button className="px-3 py-2 rounded-xl bg-red-600 text-white hover:bg-red-700" onClick={() => performDelete(deleteDialog.msgId)}>Удалить</button>
            </div>
          </div>
        </div>
      )}

      {deleteThreadDialog?.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDeleteThreadDialog({ open: false, threadId: null })} />
          <div className="relative z-10 w-[92%] max-w-sm rounded-2xl border bg-white p-4 shadow">
            <div className="text-lg font-semibold">Удалить диалог?</div>
            <div className="mt-1 text-sm text-gray-600">Будут удалены все сообщения этого диалога.</div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50" onClick={() => setDeleteThreadDialog({ open: false, threadId: null })}>Отмена</button>
              <button className="px-3 py-2 rounded-xl bg-red-600 text-white hover:bg-red-700" onClick={() => performThreadDelete(deleteThreadDialog.threadId)}>Удалить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

