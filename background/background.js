/**
 * Popup에서 전달되는 메시지를 처리
 * - SAVE_SESSION
 * - RESTORE_SESSION
 * - DELETE_SESSION
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "SAVE_SESSION") {
        saveSession(sendResponse, message.name);
        return true;
    }

    if (message.type === "RESTORE_SESSION") {
        restoreSession(message.sessionId, message.openInNewWindow);
    }

    if (message.type === "DELETE_SESSION") {
        deleteSession(message.sessionId, sendResponse);
        return true;
    }
});

/**
 * 현재 창의 탭을 세션으로 저장
 */
function saveSession(sendResponse, nameFromPopup) {
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
        const urls = tabs
            .map(tab => tab.url)
            .filter(url => url.startsWith("http://") || url.startsWith("https://"));

        chrome.storage.local.get("sessions", (data) => {
            const sessions = Array.isArray(data.sessions) ? data.sessions : [];

            const createdAt = Date.now();
            const session = {
                id: `sess_${createdAt}`,
                name: nameFromPopup || formatSessionName(createdAt),
                createdAt,
                urls
            };

            sessions.unshift(session);

            chrome.storage.local.set({ sessions }, () => {
                sendResponse({ count: urls.length });
            });
        });
    });
}

/**
 * 세션 복원
 */
function restoreSession(sessionId, openInNewWindow) {
    if (!sessionId) return;

    chrome.storage.local.get("sessions", (data) => {
        const sessions = Array.isArray(data.sessions) ? data.sessions : [];
        const session = sessions.find(s => s.id === sessionId);
        if (!session || !session.urls.length) return;

        if (openInNewWindow) {
            restoreInNewWindow(session.urls);
        } else {
            restoreInCurrentWindow(session.urls);
        }
    });
}

/**
 * 세션 삭제
 */
function deleteSession(sessionId, sendResponse) {
    chrome.storage.local.get("sessions", (data) => {
        const sessions = Array.isArray(data.sessions) ? data.sessions : [];
        const nextSessions = sessions.filter(s => s.id !== sessionId);

        chrome.storage.local.set({ sessions: nextSessions }, () => {
            sendResponse({ success: true });
        });
    });
}

/* ---------- 복원 로직 ---------- */

function restoreInCurrentWindow(urls) {
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
        if (tabs.length === 1 && tabs[0].url === "chrome://newtab/") {
            chrome.tabs.remove(tabs[0].id);
        }
        urls.forEach(url => chrome.tabs.create({ url }));
    });
}

function restoreInNewWindow(urls) {
    chrome.windows.create({}, (newWindow) => {
        chrome.tabs.query({ windowId: newWindow.id }, (tabs) => {
            chrome.tabs.update(tabs[0].id, { url: urls[0] });
            urls.slice(1).forEach(url => {
                chrome.tabs.create({ windowId: newWindow.id, url });
            });
        });
    });
}

/**
 * 기본 세션 이름 생성
 */
function formatSessionName(timestamp) {
    const d = new Date(timestamp);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
    ).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(
        d.getMinutes()
    ).padStart(2, "0")}`;
}
