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
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "SHOW_TOAST") {
        showToast(message.message, message.toastType);
    }
});

chrome.storage.sync.get([
    "openInNewWindow",
    THEME_PREFERENCE_KEY
], ({ openInNewWindow, themePreference }) => {
    checkbox.checked = Boolean(openInNewWindow);
    applyThemePreference(themePreference);
});
applyI18n();
loadPendingDeletes(() => {
    renderSessionList();
});

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
                const message = (res && res.reason === "STORAGE_ERROR")
                    ? chrome.i18n.getMessage("storageError")
                    : chrome.i18n.getMessage("noTabsToSave");
                showToast(message, "error");
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
        .map((item, index) => {
            const url = getSavedUrl(item);
            const title = getSavedTitle(item);
            const favicon = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`;

            const displayTitle = escapeHtml(title);          // 화면 표시용
            const dataUrl = encodeURIComponent(url);         // data attribute 용(안전)
            const isLastUrl = urls.length === 1;

            return `
            <li class="urlItem"
                data-session-id="${session.id}"
                data-url="${dataUrl}"
                data-index="${index}">
                <img src="${favicon}" class="urlFavicon" alt="" />
                <span class="urlText" title="${displayTitle}">${displayTitle}</span>
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

    const isDeleting = pendingDeletes.has(session.id);
    return `
<li class="sessionItem ${isOpen ? "open" : ""} ${isDeleting ? "deleteLocked" : ""}"
    data-id="${session.id}"
    draggable="true">

    <div class="sessionHeader">
        <div class="sessionName">
            <span class="arrow">▶</span>
            <span class="sessionNameText">${name}</span>
            <span class="sessionMeta">(${urls.length})</span>
        </div>

        <div class="actions">
            <button class="openBtn" data-id="${session.id}">${chrome.i18n.getMessage(pendingDeletes.has(session.id) ? "deleteNow" : "open")}</button>
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
    if (item?.classList.contains("deleteLocked")) {
        executeImmediateDelete(sessionId);
        return;
    }
    restoreSession(sessionId);
}

function executeImmediateDelete(sessionId) {
    const state = pendingDeletes.get(sessionId);
    if (state) {
        clearInterval(state.interval);
        clearTimeout(state.timer);
        pendingDeletes.delete(sessionId);
    }
    chrome.runtime.sendMessage({ type: "CANCEL_DELETE_SESSION", sessionId });
    chrome.runtime.sendMessage(
        { type: "DELETE_SESSION", sessionId },
        () => renderSessionList()
    );
}

function onDelete(e) {
    e.stopPropagation();
    const sessionId = e.currentTarget.dataset.id;
    const button = e.currentTarget;

    handleDeleteClick(button, sessionId);
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
                target.urls = target.urls.filter(u => getSavedUrl(u) !== url);
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
    chrome.storage.sync.get(["sessions", "openInNewWindow"], ({ sessions, openInNewWindow }) => {
        const list = Array.isArray(sessions) ? sessions : [];
        const session = list.find(s => s.id === sessionId);
        const urls = getSessionUrls(session);

        ensureFileAccessAllowed(urls, () => {
            chrome.runtime.sendMessage({
                type: "RESTORE_SESSION",
                sessionId,
                openInNewWindow: Boolean(openInNewWindow)
            });
        });
    });
}

function ensureFileAccessAllowed(urls, callback) {
    const hasFileUrl = urls.some(url => url.startsWith("file://"));
    if (!hasFileUrl) {
        callback();
        return;
    }

    chrome.extension.isAllowedFileSchemeAccess((allowed) => {
        if (allowed) {
            callback();
            return;
        }

        if (confirm(chrome.i18n.getMessage("fileAccessSettingsConfirm"))) {
            openExtensionSettingsPage();
        }
    });
}

function openExtensionSettingsPage() {
    chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
}

function getSessionUrls(session) {
    const items = session && Array.isArray(session.urls) ? session.urls : [];
    return items
        .map(getSavedUrl)
        .filter(Boolean);
}

function getSavedUrl(item) {
    if (typeof item === "string") return item;
    if (item && typeof item.url === "string") return item.url;
    return "";
}

function getSavedTitle(item) {
    if (item && typeof item.title === "string" && item.title.trim()) {
        return item.title;
    }
    return decodeReadableUrl(getSavedUrl(item));
}

function decodeReadableUrl(url) {
    try {
        return decodeURI(url);
    } catch {
        return url;
    }
}

function restoreUrl(url) {
    ensureFileAccessAllowed([url], () => {
        chrome.runtime.sendMessage({
            type: "RESTORE_URL",
            url
        });
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

function handleDeleteClick(button, sessionId) {
    if (pendingDeletes.has(sessionId)) {
        cancelPendingDelete(sessionId);
        return;
    }

    startDeleteCountdown(button, sessionId);
}

function startDeleteCountdown(button, sessionId) {
    const defaultContent = button.dataset.defaultContent ?? button.innerHTML;
    button.dataset.defaultContent = defaultContent;
    lockDeleteButtonWidth(button);
    setPendingDelete(sessionId, Date.now() + DELETE_UNDO_MS);
    chrome.runtime.sendMessage({ type: "SCHEDULE_DELETE_SESSION", sessionId });
    applyPendingDeleteUI(sessionId, button);
}

function loadPendingDeletes(done) {
    chrome.runtime.sendMessage({ type: "GET_PENDING_SESSION_DELETES" }, (pending) => {
        if (!chrome.runtime.lastError && pending) {
            Object.entries(pending).forEach(([sessionId, dueAt]) => {
                setPendingDelete(sessionId, dueAt);
            });
        }
        done?.();
    });
}

function setPendingDelete(sessionId, dueAt) {
    clearPendingDeleteTimer(sessionId);

    const state = {
        sessionId,
        dueAt,
        remaining: getRemainingDeleteSeconds(dueAt),
        timer: null,
        interval: null
    };
    pendingDeletes.set(sessionId, state);

    state.interval = setInterval(() => {
        const nextRemaining = getRemainingDeleteSeconds(dueAt);
        if (nextRemaining <= 0) {
            clearInterval(state.interval);
            return;
        }

        if (nextRemaining !== state.remaining) {
            state.remaining = nextRemaining;
            updateDeleteCountdown(sessionId, state.remaining);
        }
    }, 250);

    state.timer = setTimeout(() => {
        completePendingDelete(sessionId);
    }, Math.max(0, dueAt - Date.now()));
}

function clearPendingDeleteTimer(sessionId) {
    const state = pendingDeletes.get(sessionId);
    if (!state) return;

    clearTimeout(state.timer);
    clearInterval(state.interval);
    pendingDeletes.delete(sessionId);
}

function completePendingDelete(sessionId) {
    clearPendingDeleteTimer(sessionId);
    chrome.runtime.sendMessage({ type: "CANCEL_DELETE_SESSION", sessionId });
    chrome.runtime.sendMessage(
        { type: "DELETE_SESSION", sessionId },
        () => renderSessionList()
    );
}

function getRemainingDeleteSeconds(dueAt) {
    return Math.max(0, Math.ceil((dueAt - Date.now()) / 1000));
}

function cancelPendingDelete(sessionId) {
    clearPendingDeleteTimer(sessionId);
    chrome.runtime.sendMessage({ type: "CANCEL_DELETE_SESSION", sessionId });
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
        applyPendingDeleteUI(sessionId, button);
    });
}

function applyPendingDeleteUI(sessionId, button) {
    const state = pendingDeletes.get(sessionId);
    if (!state) return;

    if (!button.dataset.defaultContent) {
        button.dataset.defaultContent = button.innerHTML;
    }
    lockDeleteButtonWidth(button);
    button.classList.add("deleting");
    applyDeleteCountdownTone(button, state.remaining);
    button.innerHTML = renderDeleteCountdownContent(state.remaining);
    lockSessionForDelete(sessionId);
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

    const openBtn = item.querySelector(".openBtn");
    if (openBtn) {
        openBtn.textContent = chrome.i18n.getMessage("deleteNow");
    }
}

function unlockSessionForDelete(sessionId) {
    const item = sessionList.querySelector(`.sessionItem[data-id="${sessionId}"]`);
    if (!item) return;
    item.classList.remove("deleteLocked");

    const openBtn = item.querySelector(".openBtn");
    if (openBtn) {
        openBtn.textContent = chrome.i18n.getMessage("open");
    }
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
