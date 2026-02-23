/* ===== DOM ===== */
const sessionNameInput = document.getElementById("sessionNameInput");
const checkbox = document.getElementById("newWindowCheckbox");
const sessionList = document.getElementById("sessionList");
const emptyHint = document.getElementById("emptyHint");
const status = document.getElementById("status");
const themeToggle = document.getElementById("themeToggle");

let draggedItem = null;
const DELETE_UNDO_MS = 3000;
const DELETE_COUNTDOWN_START = 3;
const pendingDeletes = new Map();
const THEME_PREFERENCE_KEY = "themePreference";
const THEME_MODES = ["system", "light", "dark"];
const THEME_ICONS = {
    system: "⚙️",
    light: "☀️",
    dark: "🌙"
};
let currentThemePreference = "system";

function applyI18n() {
    document.querySelectorAll("[data-i18n]").forEach(el => {
        el.textContent = chrome.i18n.getMessage(el.dataset.i18n);
    });

    document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
        el.placeholder = chrome.i18n.getMessage(
            el.dataset.i18nPlaceholder
        );
    });
}

/* ===== Init ===== */
chrome.storage.sync.get([
    "openInNewWindow",
    THEME_PREFERENCE_KEY
], ({ openInNewWindow, themePreference }) => {
    checkbox.checked = Boolean(openInNewWindow);
    applyThemePreference(themePreference);
});
applyI18n();
renderSessionList();

/* ===== Events ===== */
checkbox.addEventListener("change", () => {
    chrome.storage.sync.set({ openInNewWindow: checkbox.checked });
});

themeToggle.addEventListener("click", () => {
    const currentIndex = THEME_MODES.indexOf(currentThemePreference);
    const nextPreference = THEME_MODES[(currentIndex + 1) % THEME_MODES.length];
    chrome.storage.sync.set({ [THEME_PREFERENCE_KEY]: nextPreference }, () => {
        applyThemePreference(nextPreference);
    });
});

document.getElementById("saveBtn").addEventListener("click", onSave);

sessionNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        onSave();
    }
});

/* ===== Handlers ===== */
function onSave() {
    const name = sessionNameInput.value.trim();

    if (name.length > 20) {
        showToast(
            chrome.i18n.getMessage("nameTooLong"),
            "error"
        );
        return;
    }

    chrome.runtime.sendMessage(
        { type: "SAVE_SESSION", name },
        (res) => {
            if (!res || res.success === false) {
                showToast(
                    chrome.i18n.getMessage("noTabsToSave"),
                    "error"
                );
                return;
            }

            sessionNameInput.value = "";
            showToast(
                chrome.i18n.getMessage("savedToast", [res.count]),
                "success"
            );
            renderSessionList();
        }
    );
}

function normalizeThemePreference(value) {
    return THEME_MODES.includes(value) ? value : "system";
}

function applyThemePreference(preference) {
    currentThemePreference = normalizeThemePreference(preference);
    if (currentThemePreference === "system") {
        document.documentElement.removeAttribute("data-theme");
    } else {
        document.documentElement.setAttribute("data-theme", currentThemePreference);
    }
    updateThemeToggleUI(currentThemePreference);
}

function updateThemeToggleUI(preference) {
    if (!themeToggle) return;
    themeToggle.textContent = THEME_ICONS[preference] ?? THEME_ICONS.system;
    const labelKey = preference === "dark"
        ? "themeDark"
        : preference === "light"
            ? "themeLight"
            : "themeSystem";
    const label = chrome.i18n.getMessage(labelKey);
    themeToggle.title = label;
    themeToggle.setAttribute("aria-label", label);
}

/* ===== Render ===== */
function renderSessionList(openId = null) {
    chrome.storage.sync.get("sessions", ({ sessions }) => {
        const list = Array.isArray(sessions) ? sessions : [];

        if (!list.length) {
            sessionList.innerHTML = "";
            emptyHint.classList.remove("hidden");
            return;
        }

        emptyHint.classList.add("hidden");
        sessionList.innerHTML = list.map(s => renderSessionItem(s, s.id === openId)).join("");
        bindSessionEvents();
        syncPendingDeleteUI();
    });
}

function renderSessionItem(session, isOpen = false) {
    const name = escapeHtml(session.name || "Untitled");
    const urls = Array.isArray(session.urls) ? session.urls : [];

    const urlItems = urls
        .map((url, index) => {
            const favicon = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`;

            const displayUrl = escapeHtml(url);              // 화면 표시용
            const dataUrl = encodeURIComponent(url);         // data attribute 용(안전)
            const isLastUrl = urls.length === 1;

            return `
            <li class="urlItem"
                data-session-id="${session.id}"
                data-url="${dataUrl}"
                data-index="${index}">
                <img src="${favicon}" class="urlFavicon" alt="" />
                <span class="urlText">${displayUrl}</span>
                <button class="urlDeleteBtn${isLastUrl ? " disabled" : ""}"
                        ${isLastUrl ? "disabled" : ""}
                        data-session-id="${session.id}" 
                        data-url="${dataUrl}"
                        data-index="${index}"
                        data-url-count="${urls.length}"
                        title="${chrome.i18n.getMessage("delete")}">×</button>
            </li>
        `;
        })
        .join("");

    return `
<li class="sessionItem ${isOpen ? "open" : ""}"
    data-id="${session.id}"
    draggable="true">

    <div class="sessionHeader">
        <div class="sessionName">
            <span class="arrow">▶</span>
            <span>${name}</span>
            <span class="sessionMeta">(${urls.length})</span>
        </div>

        <div class="actions">
            <button class="openBtn" data-id="${session.id}">${chrome.i18n.getMessage("open")}</button>
            <button class="deleteBtn" data-id="${session.id}">${chrome.i18n.getMessage("delete")}</button>
        </div>
    </div>

    <ul class="urlList ${isOpen ? "" : "hidden"}">${urlItems}</ul>
</li>
`;
}

/* ===== Binding ===== */
function bindSessionEvents() {
    sessionList.querySelectorAll(".openBtn")
        .forEach(btn => btn.addEventListener("click", onOpen));

    sessionList.querySelectorAll(".deleteBtn")
        .forEach(btn => btn.addEventListener("click", onDelete));

    sessionList.querySelectorAll(".sessionHeader")
        .forEach(el => el.addEventListener("click", onToggle));

    sessionList.querySelectorAll(".urlDeleteBtn")
        .forEach(btn => btn.addEventListener("click", onUrlDelete));

    sessionList.querySelectorAll(".urlItem")
        .forEach(el => el.addEventListener("click", onUrlClick));

    // ✅ Drag & Drop
    sessionList.querySelectorAll(".sessionItem")
        .forEach(el => {
            el.addEventListener("dragstart", onDragStart);
            el.addEventListener("dragover", onDragOver);
            el.addEventListener("drop", onDrop);
            el.addEventListener("dragend", onDragEnd);
        });
}

/* ===== Actions ===== */
function onToggle(e) {
    if (e.target.closest("button")) return;

    const currentItem = e.currentTarget.closest(".sessionItem");
    if (currentItem.classList.contains("deleteLocked")) return;
    const currentList = currentItem.querySelector(".urlList");

    // 🔒 다른 열려있는 세션 전부 닫기
    document.querySelectorAll(".sessionItem.open").forEach(item => {
        if (item !== currentItem) {
            item.classList.remove("open");
            item.querySelector(".urlList")?.classList.add("hidden");
        }
    });

    // 🔁 현재 세션 토글
    const isOpen = currentItem.classList.contains("open");

    currentItem.classList.toggle("open", !isOpen);
    currentList.classList.toggle("hidden", isOpen);
}

function onOpen(e) {
    e.stopPropagation();
    const sessionId = e.currentTarget.dataset.id;
    const item = e.currentTarget.closest(".sessionItem");
    if (item?.classList.contains("deleteLocked")) return;
    restoreSession(sessionId);
}

function onDelete(e) {
    e.stopPropagation();
    const sessionId = e.currentTarget.dataset.id;
    const button = e.currentTarget;

    handleDeleteClick(button, () => {
        chrome.runtime.sendMessage(
            { type: "DELETE_SESSION", sessionId },
            () => renderSessionList()
        );
    }, sessionId);
}

function onUrlClick(e) {
    if (e.target.closest(".urlDeleteBtn")) return;
    e.stopPropagation();
    const decodedUrl = decodeURIComponent(e.currentTarget.dataset.url);
    restoreUrl(decodedUrl);
}

function onUrlDelete(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    const sessionId = e.currentTarget.dataset.sessionId;
    const urlCount = Number(e.currentTarget.dataset.urlCount);
    if (Number.isFinite(urlCount) && urlCount <= 1) return;
    if (pendingDeletes.has(sessionId)) return;
    const index = Number(e.currentTarget.dataset.index);
    const url = decodeURIComponent(e.currentTarget.dataset.url);
    const button = e.currentTarget;

    chrome.runtime.sendMessage(
        { type: "DELETE_URL", sessionId, url, index },
        (response) => {
            if (chrome.runtime.lastError || !response || response.success === false) {
                deleteUrlInStorage(sessionId, index, url, () => {
                    renderSessionList(sessionId);
                });
                return;
            }

            renderSessionList(sessionId);
        }
    );
}

function deleteUrlInStorage(sessionId, index, url, done) {
    chrome.storage.sync.get("sessions", ({ sessions }) => {
        const list = Array.isArray(sessions) ? sessions : [];
        const target = list.find(s => s.id === sessionId);

        if (target) {
            if (Number.isFinite(index) && index >= 0 && index < target.urls.length) {
                target.urls.splice(index, 1);
            } else {
                target.urls = target.urls.filter(u => u !== url);
            }

            const nextSessions = target.urls.length === 0
                ? list.filter(s => s.id !== sessionId)
                : list;

            chrome.storage.sync.set({ sessions: nextSessions }, () => {
                done?.();
            });
            return;
        }

        done?.();
    });
}

/* ===== Restore ===== */
function restoreSession(sessionId) {
    chrome.storage.sync.get("openInNewWindow", ({ openInNewWindow }) => {
        chrome.runtime.sendMessage({
            type: "RESTORE_SESSION",
            sessionId,
            openInNewWindow: Boolean(openInNewWindow)
        });
    });
}

function restoreUrl(url) {
    chrome.runtime.sendMessage({
        type: "RESTORE_URL",
        url
    });
}

/* ===== Utils ===== */
function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function showToast(message, type = "success") {
    status.textContent = message;
    status.className = `toast ${type} show`;

    clearTimeout(status._timer);
    status._timer = setTimeout(() => {
        status.classList.remove("show");
    }, 1500);
}

function handleDeleteClick(button, execute, sessionId) {
    if (pendingDeletes.has(sessionId)) {
        cancelPendingDelete(sessionId);
        return;
    }

    startDeleteCountdown(button, execute, sessionId);
}

function startDeleteCountdown(button, execute, sessionId) {
    const defaultContent = button.dataset.defaultContent ?? button.innerHTML;
    button.dataset.defaultContent = defaultContent;
    lockDeleteButtonWidth(button);
    button.classList.add("deleting");
    applyDeleteCountdownTone(button, DELETE_COUNTDOWN_START);
    button.innerHTML = renderDeleteCountdownContent(DELETE_COUNTDOWN_START);

    let remaining = DELETE_COUNTDOWN_START;

    if (sessionId) {
        lockSessionForDelete(sessionId);
    }

    const state = {
        sessionId,
        execute,
        remaining,
        timer: null,
        interval: null
    };
    pendingDeletes.set(sessionId, state);

    state.interval = setInterval(() => {
        state.remaining -= 1;
        if (state.remaining <= 0) {
            clearInterval(state.interval);
            return;
        }
        updateDeleteCountdown(sessionId, state.remaining);
    }, 1000);

    state.timer = setTimeout(() => {
        clearInterval(state.interval);
        pendingDeletes.delete(sessionId);
        state.execute?.();
    }, DELETE_UNDO_MS);
}

function cancelPendingDelete(sessionId) {
    const state = pendingDeletes.get(sessionId);
    if (!state) return;
    clearTimeout(state.timer);
    clearInterval(state.interval);
    pendingDeletes.delete(sessionId);
    restoreDeleteButton(sessionId);
    unlockSessionForDelete(sessionId);
}

function renderDeleteCountdownContent(remaining) {
    return `
        <span class="deleteCountdownIcon">↺</span>
        <span class="deleteCountdownText">${remaining}</span>
    `;
}

function updateDeleteCountdown(sessionId, remaining) {
    const button = sessionList.querySelector(`.deleteBtn[data-id="${sessionId}"]`);
    if (!button) return;
    button.classList.add("deleting");
    if (!button.dataset.defaultContent) {
        button.dataset.defaultContent = button.innerHTML;
    }
    applyDeleteCountdownTone(button, remaining);
    button.innerHTML = renderDeleteCountdownContent(remaining);
}

function restoreDeleteButton(sessionId) {
    const button = sessionList.querySelector(`.deleteBtn[data-id="${sessionId}"]`);
    if (!button) return;
    const defaultContent = button.dataset.defaultContent ?? chrome.i18n.getMessage("delete");
    button.dataset.defaultContent = defaultContent;
    button.classList.remove("deleting");
    clearDeleteCountdownTone(button);
    button.innerHTML = defaultContent;
    unlockDeleteButtonWidth(button);
}

function syncPendingDeleteUI() {
    pendingDeletes.forEach((state, sessionId) => {
        const button = sessionList.querySelector(`.deleteBtn[data-id="${sessionId}"]`);
        if (!button) return;
        if (!button.dataset.defaultContent) {
            button.dataset.defaultContent = button.innerHTML;
        }
        lockDeleteButtonWidth(button);
        button.classList.add("deleting");
        applyDeleteCountdownTone(button, state.remaining);
        button.innerHTML = renderDeleteCountdownContent(state.remaining);
        lockSessionForDelete(sessionId);
    });
}

function applyDeleteCountdownTone(button, remaining) {
    if (!button) return;
    const step = Math.max(1, Math.min(DELETE_COUNTDOWN_START, remaining));
    button.classList.remove(
        "deletingStep1",
        "deletingStep2",
        "deletingStep3"
    );
    button.classList.add(`deletingStep${step}`);
}

function clearDeleteCountdownTone(button) {
    if (!button) return;
    button.classList.remove("deletingStep1", "deletingStep2", "deletingStep3");
}

function lockDeleteButtonWidth(button) {
    if (!button) return;
    if (!button.dataset.defaultWidth) {
        const width = button.getBoundingClientRect().width;
        if (width) {
            button.dataset.defaultWidth = String(Math.ceil(width));
        }
    }
    if (button.dataset.defaultWidth) {
        button.style.width = `${button.dataset.defaultWidth}px`;
    }
}

function unlockDeleteButtonWidth(button) {
    if (!button) return;
    button.style.removeProperty("width");
    if (button.dataset.defaultWidth) {
        delete button.dataset.defaultWidth;
    }
}

function lockSessionForDelete(sessionId) {
    const item = sessionList.querySelector(`.sessionItem[data-id="${sessionId}"]`);
    if (!item) return;
    item.classList.add("deleteLocked");
    item.classList.remove("open");
    item.querySelector(".urlList")?.classList.add("hidden");
}

function unlockSessionForDelete(sessionId) {
    const item = sessionList.querySelector(`.sessionItem[data-id="${sessionId}"]`);
    if (!item) return;
    item.classList.remove("deleteLocked");
}
function onDragStart(e) {
    draggedItem = e.currentTarget;
    draggedItem.classList.add("dragging");

    // 아코디언 열려 있으면 닫기
    draggedItem.classList.remove("open");
    draggedItem.querySelector(".urlList")?.classList.add("hidden");

    e.dataTransfer.effectAllowed = "move";
}

function onDragOver(e) {
    e.preventDefault();

    const target = e.currentTarget;
    if (target === draggedItem) return;

    target.classList.add("dragOver");

    const rect = target.getBoundingClientRect();
    const isAfter = e.clientY > rect.top + rect.height / 2;

    const referenceNode = isAfter ? target.nextSibling : target;
    if (referenceNode !== draggedItem) {
        sessionList.insertBefore(draggedItem, referenceNode);
    }
}

function onDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove("dragOver");
    saveNewOrder();
}

function onDragEnd() {
    document.querySelectorAll(".sessionItem")
        .forEach(el => {
            el.classList.remove("dragging");
            el.classList.remove("dragOver");
        });

    draggedItem = null;
}
function saveNewOrder() {
    const orderedIds = [...sessionList.querySelectorAll(".sessionItem")]
        .map(el => el.dataset.id);

    chrome.storage.sync.get("sessions", ({ sessions }) => {
        if (!Array.isArray(sessions)) return;

        const map = Object.fromEntries(
            sessions.map(s => [s.id, s])
        );

        const reordered = orderedIds
            .map(id => map[id])
            .filter(Boolean);

        chrome.storage.sync.set({ sessions: reordered });
    });
}
