(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);

  // ---------- Елементи сторінки ----------
  const form = $("#generatorForm");
  const situationInput = $("#situation");
  const toneInput = $("#tone");
  const styleInput = $("#style");
  const recipientInput = $("#recipient");
  const recipientCustom = $("#recipientCustom");
  const channelInput = $("#channel");
  const genreInput = $("#genre");
  const languageInput = $("#language");
  const apiKeyInput = $("#apiKey");
  const saveKeyBtn = $("#saveKeyBtn");
  const forgetKeyBtn = $("#forgetKeyBtn");
  const toggleKeyBtn = $("#toggleKey");
  const generateBtn = $("#generateBtn");
  const generateLabel = $("#generateLabel");
  const resetBtn = $("#resetBtn");
  const message = $("#message");
  const charCount = $("#charCount");
  const stepPill = $("#stepPill");
  const systemStatusText = $("#systemStatusText");
  const examples = $("#examples");
  const resultsSection = $("#resultsSection");
  const outputList = $("#outputList");
  const copyAllBtn = $("#copyAllBtn");
  const regenBtn = $("#regenBtn");
  const collectionList = $("#collectionList");
  const historyTab = $("#historyTab");
  const favoritesTab = $("#favoritesTab");
  const historyCount = $("#historyCount");
  const favoritesCount = $("#favoritesCount");
  const clearCollectionBtn = $("#clearCollectionBtn");
  const themeWrap = $("#themeWrap");
  const themeBtn = $("#themeBtn");
  const themeMenu = $("#themeMenu");
  const themeGrid = $("#themeGrid");
  const themeName = $("#themeName");
  const customColorInput = $("#customColor");

  // ---------- Налаштування ----------
  const API_URL = "https://api.groq.com/openai/v1/chat/completions";

  // Якщо перша модель недоступна або перевантажена, пробуємо наступну.
  const MODELS = [
    { id: "llama-3.3-70b-versatile", maxTokens: 1200 },
    { id: "openai/gpt-oss-120b", maxTokens: 3000, extra: { reasoning_effort: "low" } },
    { id: "llama-3.1-8b-instant", maxTokens: 1200 }
  ];

  const REQUEST_TIMEOUT_MS = 25000;
  const MAX_SITUATION = 1200;
  const MAX_HISTORY = 60;
  const MAX_FAVORITES = 100;

  const HISTORY_KEY = "vidmazator_history_v1";
  const FAVORITES_KEY = "vidmazator_favorites_v1";
  const PREFS_KEY = "vidmazator_prefs_v1";
  // Ключ зберігається лише в sessionStorage (до закриття вкладки) і лише за явним кліком.
  const SESSION_KEY = "vidmazator_groq_key_session";

  // ---------- Стан ----------
  let history = readList(HISTORY_KEY);
  let favorites = readList(FAVORITES_KEY);
  let currentAnswers = [];
  let lastSituation = "";
  let activeCollection = "history";
  let isGenerating = false;
  let favoriteButtons = [];

  class GroqError extends Error {
    constructor(text, { status = 0, fatal = false } = {}) {
      super(text);
      this.name = "GroqError";
      this.status = status;
      this.fatal = fatal;
    }
  }

  // ---------- Сховище ----------
  function getStorage(kind) {
    try {
      return window[kind];
    } catch {
      return null;
    }
  }

  function storageGet(kind, key) {
    try {
      return getStorage(kind)?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  function storageSet(kind, key, value) {
    try {
      const storage = getStorage(kind);
      if (!storage) return false;
      storage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  function storageRemove(kind, key) {
    try {
      getStorage(kind)?.removeItem(key);
    } catch {
      /* нічого не робимо */
    }
  }

  function readList(key) {
    try {
      const value = JSON.parse(storageGet("localStorage", key) || "[]");
      if (!Array.isArray(value)) return [];
      return value
        .filter((item) => item && typeof item.text === "string" && item.text.trim())
        .map((item) => ({
          id: item.id || makeId(),
          text: item.text,
          situation: typeof item.situation === "string" ? item.situation : "",
          createdAt: item.createdAt || new Date().toISOString()
        }));
    } catch {
      return [];
    }
  }

  function saveStorage() {
    const okHistory = storageSet("localStorage", HISTORY_KEY, JSON.stringify(history));
    const okFavorites = storageSet("localStorage", FAVORITES_KEY, JSON.stringify(favorites));
    if (!okHistory || !okFavorites) {
      showMessage("Не вдалося зберегти історію у браузері.", "error");
    }
  }

  const CUSTOM_RECIPIENT = "__custom__";

  function savePrefs() {
    storageSet("localStorage", PREFS_KEY, JSON.stringify({
      tone: toneInput.value,
      style: styleInput.value,
      recipient: recipientInput.value,
      recipientCustom: recipientCustom.value.slice(0, 80),
      channel: channelInput.value,
      genre: genreInput.value,
      language: languageInput.value
    }));
  }

  function loadPrefs() {
    try {
      const prefs = JSON.parse(storageGet("localStorage", PREFS_KEY) || "{}") || {};
      applySelectValue(toneInput, prefs.tone);
      applySelectValue(styleInput, prefs.style);
      applySelectValue(recipientInput, prefs.recipient);
      applySelectValue(channelInput, prefs.channel);
      applySelectValue(genreInput, prefs.genre);
      applySelectValue(languageInput, prefs.language);
      if (typeof prefs.recipientCustom === "string") {
        recipientCustom.value = prefs.recipientCustom.slice(0, 80);
      }
    } catch {
      /* ігноруємо пошкоджені налаштування */
    }
    syncRecipient();
  }

  // Показує поле для довільного адресата лише при виборі «Інше…».
  function syncRecipient() {
    const isCustom = recipientInput.value === CUSTOM_RECIPIENT;
    recipientCustom.classList.toggle("hidden", !isCustom);
  }

  // Текстова назва адресата для промпту (порожньо — «універсально»).
  function recipientText() {
    if (recipientInput.value === CUSTOM_RECIPIENT) {
      return recipientCustom.value.replace(/\s+/g, " ").trim().slice(0, 80);
    }
    return recipientInput.value;
  }

  function applySelectValue(select, value) {
    if (value && Array.from(select.options).some((option) => option.value === value)) {
      select.value = value;
    }
  }

  // ---------- Допоміжні функції ----------
  function makeId() {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function truncate(text, limit) {
    return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
  }

  function formatDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("uk-UA", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
    });
  }

  function showMessage(text, type = "") {
    message.textContent = text;
    message.className = `message ${type}`.trim();
  }

  function makeButton(label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => onClick(button));
    return button;
  }

  function setLoading(value) {
    isGenerating = value;
    generateBtn.disabled = value;
    regenBtn.disabled = value;
    generateBtn.classList.toggle("is-loading", value);
    generateLabel.textContent = value ? "ГЕНЕРАЦІЯ..." : "ЗГЕНЕРУВАТИ ВІДПОВІДІ";
    generateBtn.querySelector(".sparkle").textContent = value ? "◌" : "✦";
    outputList.setAttribute("aria-busy", String(value));
  }

  function updateCounter() {
    charCount.textContent = `${situationInput.value.length} / ${MAX_SITUATION}`;
  }

  function updateStep() {
    let step = 1;
    if (situationInput.value.trim().length >= 4) step = 2;
    if (currentAnswers.length) step = 3;
    stepPill.textContent = `КРОК 0${step} / 03`;
  }

  // ---------- API-ключ ----------
  function cleanKey(raw) {
    return raw
      .trim()
      .replace(/^bearer\s+/i, "")
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
      .trim();
  }

  function validateKey(key) {
    if (!key) return "Встав API-ключ Groq у правій панелі.";
    if (!/^[\x21-\x7E]+$/.test(key)) {
      return "Ключ містить зайві символи або пробіли. Скопіюй його ще раз повністю.";
    }
    if (!key.startsWith("gsk_")) {
      return "Ключ Groq має починатися на «gsk_». Перевір, чи скопіював його повністю.";
    }
    return "";
  }

  function updateKeyStatus() {
    const ready = !validateKey(cleanKey(apiKeyInput.value));
    document.body.dataset.key = ready ? "ready" : "missing";
    systemStatusText.textContent = ready ? "КЛЮЧ ДОДАНО" : "ПОТРІБЕН API-КЛЮЧ";
  }

  // ---------- Колекція (історія та обране) ----------
  function isFavorite(text) {
    return favorites.some((item) => item.text === text);
  }

  function setFavorite(text, situation, value) {
    favorites = favorites.filter((item) => item.text !== text);
    if (value) {
      favorites.unshift({
        id: makeId(),
        text,
        situation: situation || "",
        createdAt: new Date().toISOString()
      });
    }
    favorites = favorites.slice(0, MAX_FAVORITES);
    saveStorage();
    renderCollection();
    refreshFavoriteButtons();
  }

  function refreshFavoriteButtons() {
    favoriteButtons.forEach(({ button, text }) => {
      const saved = isFavorite(text);
      button.textContent = saved ? "♥ В обраному" : "♡ В обране";
      button.classList.toggle("is-favorite", saved);
    });
  }

  function renderCollection() {
    const listName = activeCollection;
    const items = listName === "history" ? history : favorites;
    collectionList.replaceChildren();

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = listName === "history"
        ? "Історія поки порожня. Згенеруй першу відповідь."
        : "Ти ще не додав відповіді в обране.";
      collectionList.append(empty);
    } else {
      items.slice(0, 30).forEach((item) => {
        const card = document.createElement("article");
        card.className = "list-item";

        if (item.situation) {
          const situation = document.createElement("div");
          situation.className = "list-item-situation";
          situation.textContent = `Ситуація: ${truncate(item.situation, 90)}`;
          card.append(situation);
        }

        const text = document.createElement("div");
        text.className = "list-item-text";
        text.textContent = item.text;

        const date = document.createElement("div");
        date.className = "list-item-date";
        date.textContent = formatDate(item.createdAt);

        const actions = document.createElement("div");
        actions.className = "list-item-actions";
        actions.append(makeButton("Копіювати", (button) => copyText(item.text, button)));

        if (listName === "history") {
          const saved = isFavorite(item.text);
          actions.append(makeButton(saved ? "♥ В обраному" : "♡ В обране", () => {
            setFavorite(item.text, item.situation, !isFavorite(item.text));
          }));
        }

        if (item.situation) {
          actions.append(makeButton("↺ Ситуація", () => {
            situationInput.value = item.situation.slice(0, MAX_SITUATION);
            updateCounter();
            updateStep();
            situationInput.focus();
            situationInput.scrollIntoView({ behavior: "smooth", block: "center" });
          }));
        }

        actions.append(makeButton("Видалити", () => {
          if (listName === "history") {
            history = history.filter((entry) => entry.id !== item.id);
          } else {
            favorites = favorites.filter((entry) => entry.id !== item.id);
          }
          saveStorage();
          renderCollection();
          refreshFavoriteButtons();
        }));

        card.append(text, date, actions);
        collectionList.append(card);
      });
    }

    historyCount.textContent = history.length;
    favoritesCount.textContent = favorites.length;
    historyTab.classList.toggle("active", listName === "history");
    favoritesTab.classList.toggle("active", listName === "favorites");
    historyTab.setAttribute("aria-selected", String(listName === "history"));
    favoritesTab.setAttribute("aria-selected", String(listName === "favorites"));
    clearCollectionBtn.textContent = listName === "history"
      ? "ОЧИСТИТИ ІСТОРІЮ" : "ОЧИСТИТИ ОБРАНЕ";
  }

  // ---------- Результати ----------
  function renderOutputMessage(text, isError = false) {
    outputList.replaceChildren();
    const box = document.createElement("div");
    box.className = isError ? "empty is-error" : "empty";
    box.textContent = text;
    outputList.append(box);
  }

  function renderSkeleton() {
    outputList.replaceChildren();
    for (let i = 0; i < 3; i += 1) {
      const card = document.createElement("div");
      card.className = "skeleton-card";
      card.setAttribute("aria-hidden", "true");
      ["", "mid", "short"].forEach((modifier) => {
        const line = document.createElement("div");
        line.className = `skeleton-line ${modifier}`.trim();
        card.append(line);
      });
      outputList.append(card);
    }
  }

  function renderAnswers(answers) {
    outputList.replaceChildren();
    favoriteButtons = [];

    answers.forEach((answer, index) => {
      const card = document.createElement("article");
      card.className = "answer-card";
      card.style.animationDelay = `${index * 70}ms`;

      const top = document.createElement("div");
      top.className = "answer-top";
      const number = document.createElement("span");
      number.className = "answer-number";
      number.textContent = `ВАРІАНТ 0${index + 1}`;
      top.append(number);

      const text = document.createElement("p");
      text.className = "answer-text";
      text.textContent = answer;

      const actions = document.createElement("div");
      actions.className = "answer-actions";

      const copy = makeButton("Копіювати ↗", (button) => copyText(answer, button));
      const favorite = makeButton("♡ В обране", () => {
        setFavorite(answer, lastSituation, !isFavorite(answer));
      });
      favoriteButtons.push({ button: favorite, text: answer });

      actions.append(copy, favorite);
      card.append(top, text, actions);
      outputList.append(card);
    });

    refreshFavoriteButtons();
    copyAllBtn.classList.toggle("hidden", answers.length === 0);
    regenBtn.classList.toggle("hidden", answers.length === 0);
  }

  // ---------- Копіювання ----------
  function fallbackCopy(text) {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }

  async function copyText(text, button) {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      ok = fallbackCopy(text);
    }

    if (!ok) {
      showMessage("Не вдалося скопіювати. Виділи текст і скопіюй вручну.", "error");
      return;
    }

    if (!button.dataset.original) button.dataset.original = button.textContent;
    button.textContent = "Скопійовано ✓";
    clearTimeout(button._copyTimer);
    button._copyTimer = setTimeout(() => {
      button.textContent = button.dataset.original;
    }, 1400);
  }

  // ---------- Запит до Groq ----------
  function lengthHint(style, channel) {
    const value = style.toLowerCase();
    // Явний вибір довжини в «Форматі» важливіший за особливості каналу.
    if (value.includes("короткий")) return "1–2 речення";
    if (value.includes("детальний")) return "4–6 речень";
    if (/^sms/i.test(channel)) return "1–2 речення";
    return "2–4 речення";
  }

  function buildMessages(situation, avoid) {
    const recipient = recipientText();
    const channel = channelInput.value;
    const genre = genreInput.value;
    const plainGenre = genre === genreInput.options[0]?.value;
    const language = languageInput.value || "Українська";

    const system = [
      "Ти — помічник сервісу «Відмазатор». Допомагаєш людині знайти слова, щоб ввічливо й природно вийти з незручної ситуації.",
      "Створи рівно 3 різні варіанти готового повідомлення, яке людина може надіслати від першої особи.",
      "Правила:",
      `- Мова варіантів: ${language}. Інструкції тобі подано українською, але всі варіанти пиши мовою «${language}».`,
      recipient
        ? `- Адресат: ${recipient}. Підбери звертання та рівень офіційності так, як людина говорила б саме з ним (ввічливе «Ви» чи «ти» — залежно від адресата).`
        : "- Адресат не вказаний: пиши універсально, без звертань до конкретної ролі.",
      `- Канал: ${channel}.`,
      `- Тон: ${toneInput.value}.`,
      `- Формат: ${styleInput.value}. Довжина кожного варіанта: ${lengthHint(styleInput.value, channel)}.`,
      plainGenre
        ? "- Жанр: звичайне повідомлення без стилізації."
        : `- Жанр: ${genre}. Витримуй цю подачу, але зміст має лишатися зрозумілим, а повідомлення — таким, яке справді можна надіслати.`,
      "- Без образ, погроз, маніпуляцій і небезпечних порад.",
      "- Не вигадуй конкретних фактів, яких людина не повідомляла: імен, адрес, діагнозів, аварій, подій із близькими.",
      "- Не пропонуй підробляти документи чи обманювати в серйозних питаннях (робота, навчання, медицина, гроші, закон) — у таких випадках обирай чесне пояснення.",
      "- Якщо доречно, тактовно визнай відповідальність і запропонуй, як виправити ситуацію.",
      "- Варіанти мають відрізнятися підходом, а не лише словами. Не повторюй одну й ту саму думку.",
      "- Не додавай заголовків, нумерації чи пояснень усередині варіантів.",
      "Відповідай лише валідним JSON без markdown і без жодного іншого тексту: {\"answers\":[\"варіант 1\",\"варіант 2\",\"варіант 3\"]}"
    ].join("\n");

    let user = `Ситуація: ${situation}`;
    if (avoid.length) {
      user += `\n\nВже запропоновані варіанти (придумай зовсім інші, не повторюй їх):\n${avoid.map((item) => `- ${item}`).join("\n")}`;
    }

    return [
      { role: "system", content: system },
      { role: "user", content: user }
    ];
  }

  function tryParse(text) {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  function extractAnswers(raw) {
    if (typeof raw !== "string") return [];

    const text = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    let parsed = tryParse(text);

    if (parsed === undefined) {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start !== -1 && end > start) parsed = tryParse(text.slice(start, end + 1));
    }
    if (parsed === undefined) {
      const start = text.indexOf("[");
      const end = text.lastIndexOf("]");
      if (start !== -1 && end > start) parsed = tryParse(text.slice(start, end + 1));
    }

    let list = [];
    if (Array.isArray(parsed)) {
      list = parsed;
    } else if (parsed && typeof parsed === "object") {
      list = Array.isArray(parsed.answers)
        ? parsed.answers
        : (Object.values(parsed).find(Array.isArray) || []);
    } else if (parsed === undefined && !/^[\[{]/.test(text)) {
      // AI відповів звичайним текстом: ділимо на абзаци або нумеровані пункти.
      list = text
        .split(/\n{2,}|\n(?=\s*(?:\d+[.)]|[-•*])\s)/)
        .map((part) => part.replace(/^\s*(?:\d+[.)]|[-•*])\s*/, ""));
    }

    return list
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item.text === "string") return item.text;
        return "";
      })
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 3);
  }

  async function callOnce(model, messages, key, jsonMode) {
    const body = {
      model: model.id,
      messages,
      temperature: 0.8,
      max_completion_tokens: model.maxTokens,
      ...(model.extra || {})
    };
    if (jsonMode) body.response_format = { type: "json_object" };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    let data;

    try {
      response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      data = await response.json().catch(() => ({}));
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw new GroqError("Groq відповідає надто довго. Спробуй ще раз.");
      }
      throw new GroqError(
        "Не вдалося з'єднатися з Groq. Перевір інтернет, вимкни VPN чи блокувальник реклами й спробуй ще раз.",
        { fatal: true }
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const detail = data?.error?.message || "";
      const status = response.status;

      if (status === 401) {
        throw new GroqError("Groq не прийняв API-ключ. Перевір, чи правильно ти його вставив.", { status, fatal: true });
      }
      if (status === 403) {
        throw new GroqError("Groq відмовив у доступі (403). Перевір ключ; якщо він правильний — спробуй інше мережеве підключення.", { status, fatal: true });
      }
      if (status === 429) {
        throw new GroqError("Перевищено ліміт запитів Groq. Зачекай хвилину й повтори.", { status });
      }
      throw new GroqError(
        detail ? `Помилка Groq (${status}): ${detail}` : `Помилка API (${status}).`,
        { status }
      );
    }

    const content = data?.choices?.[0]?.message?.content;
    if (!content || !content.trim()) {
      throw new GroqError("AI повернув порожню відповідь.");
    }

    const answers = extractAnswers(content);
    if (!answers.length) {
      throw new GroqError("AI повернув відповідь у неправильному форматі. Спробуй ще раз.");
    }
    return answers;
  }

  async function askModel(model, messages, key) {
    try {
      return await callOnce(model, messages, key, true);
    } catch (error) {
      // Деякі моделі не підтримують JSON-режим: повторюємо без нього.
      if (error instanceof GroqError && error.status === 400) {
        return callOnce(model, messages, key, false);
      }
      throw error;
    }
  }

  async function requestGroq(situation, key, avoid) {
    const messages = buildMessages(situation, avoid);
    const errors = [];

    for (const model of MODELS) {
      try {
        return await askModel(model, messages, key);
      } catch (error) {
        if (!(error instanceof GroqError)) throw error;
        if (error.fatal) throw error;
        console.warn(`Модель ${model.id} не спрацювала:`, error.message);
        errors.push(error);
      }
    }

    throw errors.find((error) => error.status === 429)
      || errors[0]
      || new GroqError("AI не створив відповіді. Спробуй змінити опис ситуації.");
  }

  // ---------- Генерація ----------
  function pluralVariants(count) {
    return count === 1 ? "варіант" : "варіанти";
  }

  async function generate(event) {
    if (event) event.preventDefault();
    if (isGenerating) return;

    const situation = situationInput.value.trim();
    if (situation.length < 4) {
      showMessage("Опиши ситуацію трохи детальніше (мінімум 4 символи).", "error");
      situationInput.focus();
      return;
    }

    const key = cleanKey(apiKeyInput.value);
    const keyProblem = validateKey(key);
    if (keyProblem) {
      showMessage(keyProblem, "error");
      apiKeyInput.focus();
      return;
    }

    const avoid = lastSituation === situation ? currentAnswers.slice() : [];

    setLoading(true);
    currentAnswers = [];
    favoriteButtons = [];
    copyAllBtn.classList.add("hidden");
    regenBtn.classList.add("hidden");
    renderSkeleton();
    updateStep();
    showMessage("AI готує три варіанти відповіді...");
    resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });

    try {
      const answers = await requestGroq(situation, key, avoid);
      currentAnswers = answers;
      lastSituation = situation;
      renderAnswers(answers);

      const now = new Date().toISOString();
      const entries = answers.map((text) => ({ id: makeId(), text, situation, createdAt: now }));
      history = [...entries, ...history].slice(0, MAX_HISTORY);
      saveStorage();
      renderCollection();

      showMessage(`Готово! Створено ${answers.length} ${pluralVariants(answers.length)} відповіді.`, "success");
    } catch (error) {
      console.error("Groq generation error:", error);
      const text = error instanceof GroqError
        ? error.message
        : "Сталася неочікувана помилка. Оновіть сторінку й спробуйте ще раз.";
      renderOutputMessage("Не вдалося отримати відповіді. " + text, true);
      showMessage(text, "error");
    } finally {
      setLoading(false);
      updateStep();
    }
  }

  // ---------- Події ----------
  form.addEventListener("submit", generate);

  situationInput.addEventListener("input", () => {
    updateCounter();
    updateStep();
  });

  situationInput.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      if (typeof form.requestSubmit === "function") form.requestSubmit();
      else generate();
    }
  });

  examples.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-text]");
    if (!chip) return;
    situationInput.value = chip.dataset.text;
    updateCounter();
    updateStep();
    showMessage("");
    situationInput.focus();
  });

  [toneInput, styleInput, channelInput, genreInput, languageInput].forEach((select) => {
    select.addEventListener("change", savePrefs);
  });

  recipientInput.addEventListener("change", () => {
    syncRecipient();
    savePrefs();
    if (recipientInput.value === CUSTOM_RECIPIENT) recipientCustom.focus();
  });
  recipientCustom.addEventListener("input", savePrefs);

  resetBtn.addEventListener("click", () => {
    form.reset();
    syncRecipient();
    savePrefs();
    updateCounter();
    updateStep();
    showMessage("Форму очищено.");
    situationInput.focus();
  });

  apiKeyInput.addEventListener("input", updateKeyStatus);

  toggleKeyBtn.addEventListener("click", () => {
    const visible = apiKeyInput.type === "password";
    apiKeyInput.type = visible ? "text" : "password";
    toggleKeyBtn.setAttribute("aria-pressed", String(visible));
    toggleKeyBtn.textContent = visible ? "◎" : "◉";
  });

  saveKeyBtn.addEventListener("click", () => {
    const key = cleanKey(apiKeyInput.value);
    const problem = validateKey(key);
    if (problem) {
      showMessage(problem, "error");
      apiKeyInput.focus();
      return;
    }
    apiKeyInput.value = key;
    const stored = storageSet("sessionStorage", SESSION_KEY, key);
    updateKeyStatus();
    if (stored) {
      showMessage("Ключ запам'ятано до закриття вкладки. Можна генерувати!", "success");
    } else {
      showMessage("Ключ додано, але браузер не дозволив запам'ятати його. Він діятиме до перезавантаження.", "error");
    }
  });

  forgetKeyBtn.addEventListener("click", () => {
    apiKeyInput.value = "";
    storageRemove("sessionStorage", SESSION_KEY);
    updateKeyStatus();
    showMessage("Ключ видалено з цієї вкладки.");
  });

  historyTab.addEventListener("click", () => {
    activeCollection = "history";
    renderCollection();
  });

  favoritesTab.addEventListener("click", () => {
    activeCollection = "favorites";
    renderCollection();
  });

  clearCollectionBtn.addEventListener("click", () => {
    const isHistory = activeCollection === "history";
    const list = isHistory ? history : favorites;
    if (!list.length) return;
    if (!confirm(isHistory ? "Очистити всю історію?" : "Очистити все обране?")) return;
    if (isHistory) history = [];
    else favorites = [];
    saveStorage();
    renderCollection();
    refreshFavoriteButtons();
  });

  copyAllBtn.addEventListener("click", () => {
    if (currentAnswers.length) copyText(currentAnswers.join("\n\n"), copyAllBtn);
  });

  regenBtn.addEventListener("click", () => generate());

  // ---------- Теми ----------
  // Усі відтінки теми обчислюються з одного базового кольору, тому
  // готові теми та «свій колір» працюють за однією формулою.
  const THEME_KEY = "vidmazator_theme_v1";
  const THEME_PROPS = [
    "--accent", "--accent-bright", "--accent-strong", "--accent-text", "--accent-hover",
    "--accent-deep", "--accent-rgb", "--accent-strong-rgb", "--glow-rgb", "--on-accent"
  ];

  const THEMES = [
    { id: "red", name: "Червоний", color: "#ff3548" },
    { id: "orange", name: "Помаранчевий", color: "#f97316" },
    { id: "amber", name: "Бурштиновий", color: "#f59e0b" },
    { id: "emerald", name: "Смарагдовий", color: "#10b981" },
    { id: "cyan", name: "Бірюзовий", color: "#06b6d4" },
    { id: "blue", name: "Синій", color: "#3b82f6" },
    { id: "violet", name: "Фіолетовий", color: "#8b5cf6" },
    { id: "pink", name: "Рожевий", color: "#ec4899" }
  ];

  let swatchButtons = [];

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function hexToRgb(hex) {
    const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
    if (!match) return null;
    const value = parseInt(match[1], 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  function rgbToHex(rgb) {
    return `#${rgb.map((part) => part.toString(16).padStart(2, "0")).join("")}`;
  }

  function rgbToHsl([red, green, blue]) {
    const r = red / 255;
    const g = green / 255;
    const b = blue / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    const lightness = (max + min) / 2;
    const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
    let hue = 0;
    if (delta !== 0) {
      if (max === r) hue = ((g - b) / delta) % 6;
      else if (max === g) hue = (b - r) / delta + 2;
      else hue = (r - g) / delta + 4;
      hue *= 60;
      if (hue < 0) hue += 360;
    }
    return [hue, saturation * 100, lightness * 100];
  }

  function hslToRgb(hue, saturation, lightness) {
    const s = saturation / 100;
    const l = lightness / 100;
    const k = (n) => (n + hue / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const channel = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [channel(0), channel(8), channel(4)].map((value) => Math.round(value * 255));
  }

  function luminance(rgb) {
    const [r, g, b] = rgb.map((value) => {
      const part = value / 255;
      return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function buildThemeVars(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return null;

    const [hue, saturation, lightness] = rgbToHsl(rgb);
    // Занадто темний або надто світлий колір погано читається на чорному фоні.
    const base = clamp(lightness, 38, 70);
    const make = (sat, light) => hslToRgb(hue, clamp(sat, 0, 100), clamp(light, 0, 100));

    const accent = make(saturation, base);
    // Темніший кінець градієнта трохи менш насичений, щоб колір не «неонив».
    const strong = make(saturation * 0.8, base - 13);
    const glow = make(Math.min(saturation, 70), 26);
    const whiteContrast = 1.05 / (luminance(accent) + 0.05);

    return {
      "--accent": rgbToHex(accent),
      "--accent-bright": rgbToHex(make(saturation, base + 6)),
      "--accent-strong": rgbToHex(strong),
      "--accent-text": rgbToHex(make(saturation, Math.min(base + 14, 86))),
      "--accent-hover": rgbToHex(make(saturation, Math.min(base + 20, 91))),
      "--accent-deep": rgbToHex(make(saturation * 0.6, Math.min(base - 29, 32))),
      "--accent-rgb": accent.join(", "),
      "--accent-strong-rgb": strong.join(", "),
      "--glow-rgb": glow.join(", "),
      "--on-accent": whiteContrast >= 3.2 ? "#ffffff" : "#0b0b10"
    };
  }

  function applyThemeVars(vars) {
    const style = document.documentElement.style;
    THEME_PROPS.forEach((prop) => style.removeProperty(prop));
    if (!vars) return;
    THEME_PROPS.forEach((prop) => {
      if (vars[prop]) style.setProperty(prop, vars[prop]);
    });
  }

  function syncThemeUi(id, name, color) {
    swatchButtons.forEach(({ id: swatchId, button }) => {
      button.setAttribute("aria-pressed", String(swatchId === id));
    });
    themeName.textContent = name;
    if (id !== "custom") customColorInput.value = color;
  }

  function setTheme(id, customHex, { persist = true } = {}) {
    let themeId = id;
    let vars = null;
    let name;
    let color;

    if (themeId === "custom" && hexToRgb(customHex)) {
      color = String(customHex).toLowerCase();
      vars = buildThemeVars(color);
      name = "Свій колір";
    } else {
      const preset = THEMES.find((theme) => theme.id === themeId) || THEMES[0];
      themeId = preset.id;
      color = preset.color;
      name = preset.name;
      // Червона тема — значення за замовчуванням із style.css.
      vars = themeId === "red" ? null : buildThemeVars(color);
    }

    document.documentElement.setAttribute("data-theme", themeId);
    applyThemeVars(vars);
    if (persist) {
      storageSet("localStorage", THEME_KEY, JSON.stringify({ id: themeId, color, vars }));
    }
    syncThemeUi(themeId, name, color);
  }

  function buildSwatches() {
    themeGrid.replaceChildren();
    swatchButtons = [];
    THEMES.forEach((theme) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "swatch";
      button.title = theme.name;
      button.setAttribute("aria-label", theme.name);
      button.setAttribute("aria-pressed", "false");
      button.style.setProperty("--sw", theme.color);
      button.addEventListener("click", () => setTheme(theme.id));
      themeGrid.append(button);
      swatchButtons.push({ id: theme.id, button });
    });
  }

  function toggleThemeMenu(open) {
    const next = typeof open === "boolean" ? open : themeMenu.classList.contains("hidden");
    themeMenu.classList.toggle("hidden", !next);
    themeBtn.setAttribute("aria-expanded", String(next));
  }

  function initTheme() {
    buildSwatches();

    let saved = null;
    try {
      saved = JSON.parse(storageGet("localStorage", THEME_KEY) || "null");
    } catch {
      saved = null;
    }

    if (saved && saved.id === "custom" && hexToRgb(saved.color)) {
      setTheme("custom", saved.color, { persist: false });
      customColorInput.value = saved.color;
    } else {
      setTheme(saved && saved.id, null, { persist: false });
    }
  }

  themeBtn.addEventListener("click", () => toggleThemeMenu());

  customColorInput.addEventListener("input", () => {
    setTheme("custom", customColorInput.value);
  });

  document.addEventListener("click", (event) => {
    if (!themeWrap.contains(event.target)) toggleThemeMenu(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !themeMenu.classList.contains("hidden")) {
      toggleThemeMenu(false);
      themeBtn.focus();
    }
  });

  // ---------- Старт ----------
  initTheme();
  loadPrefs();
  const savedKey = storageGet("sessionStorage", SESSION_KEY);
  if (savedKey) apiKeyInput.value = savedKey;
  updateKeyStatus();
  updateCounter();
  updateStep();
  renderCollection();
})();