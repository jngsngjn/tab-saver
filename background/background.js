/**
 * 앱 설치/업데이트 시 로컬 데이터를 동기화 저장소로 마이그레이션
 */
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.get(null, (localData) => {
        if (localData && Object.keys(localData).length > 0) {
            chrome.storage.sync.get(null, (syncData) => {
                // 동기화 저장소가 비어있는 경우에만 마이그레이션 진행
                if (!syncData || Object.keys(syncData).length === 0) {
                    chrome.storage.sync.set(localData, () => {
                        console.log("Data migrated from local to sync storage.");
                    });
                }
            });
        }
    });
});

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

    if (message.type === "RESTORE_DOMAIN") {
        restoreDomain(
            message.sessionId,
            message.domain,
            message.openInNewWindow
        );
    }

    if (message.type === "RESTORE_URL") {
        chrome.tabs.create({ url: message.url });
    }

    if (message.type === "DELETE_SESSION") {
        deleteSession(message.sessionId, sendResponse);
        return true;
    }

    if (message.type === "DELETE_URL") {
        deleteUrl(message.sessionId, message.url, sendResponse, message.index);
        return true;
    }

    if (message.type === "RENAME_SESSION") {
        renameSession(message.sessionId, message.name, sendResponse);
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
            .filter(isSavableUrl);

        // ✅ 1차 방어
        if (urls.length === 0) {
            sendResponse({
                success: false,
                reason: "NO_VALID_TABS"
            });
            return;
        }

        chrome.storage.sync.get("sessions", (data) => {
            // ✅ 2차 방어 (안전장치)
            if (urls.length === 0) {
                sendResponse({
                    success: false,
                    reason: "NO_VALID_TABS"
                });
                return;
            }

            const sessions = Array.isArray(data.sessions) ? data.sessions : [];

            const createdAt = Date.now();
            const session = {
                id: `sess_${createdAt}`,
                name: nameFromPopup || formatSessionName(createdAt),
                createdAt,
                urls
            };

            sessions.unshift(session);

            chrome.storage.sync.set({ sessions }, () => {
                sendResponse({
                    success: true,
                    count: urls.length
                });
            });
        });
    });
}

/**
 * 세션 복원
 */
function restoreSession(sessionId, openInNewWindow) {
    if (!sessionId) return;

    chrome.storage.sync.get("sessions", (data) => {
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
 * 특정 세션에서 특정 도메인만 복원
 */
function restoreDomain(sessionId, domain, openInNewWindow) {
    if (!sessionId || !domain) return;

    chrome.storage.sync.get("sessions", (data) => {
        const sessions = Array.isArray(data.sessions) ? data.sessions : [];
        const session = sessions.find(s => s.id === sessionId);
        if (!session) return;

        const urls = session.urls.filter((url) => {
            try {
                if (url.startsWith("file://")) {
                    return domain === "Local Files";
                }
                return new URL(url).hostname === domain;
            } catch {
                return false;
            }
        });

        if (!urls.length) return;

        if (openInNewWindow) {
            restoreInNewWindow(urls);
        } else {
            restoreInCurrentWindow(urls);
        }
    });
}

/**
 * 세션 삭제
 */
function deleteSession(sessionId, sendResponse) {
    chrome.storage.sync.get("sessions", (data) => {
        const sessions = Array.isArray(data.sessions) ? data.sessions : [];
        const nextSessions = sessions.filter(s => s.id !== sessionId);

        chrome.storage.sync.set({ sessions: nextSessions }, () => {
            sendResponse({ success: true });
        });
    });
}

/**
 * 세션 내 특정 URL 삭제
 */
function deleteUrl(sessionId, url, sendResponse, index) {
    chrome.storage.sync.get("sessions", (data) => {
        const sessions = Array.isArray(data.sessions) ? data.sessions : [];
        const target = sessions.find(s => s.id === sessionId);
        
        if (target) {
            if (Number.isFinite(index) && index >= 0 && index < target.urls.length) {
                target.urls.splice(index, 1);
            } else {
                target.urls = target.urls.filter(u => u !== url);
            }
            
            // 만약 세션 내 탭이 하나도 남지 않았다면 세션 자체를 삭제
            const nextSessions = target.urls.length === 0 
                ? sessions.filter(s => s.id !== sessionId)
                : sessions;

            chrome.storage.sync.set({ sessions: nextSessions }, () => {
                sendResponse({ success: true });
            });
        } else {
            sendResponse({ success: false });
        }
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

function renameSession(sessionId, newName, sendResponse) {
    if (!sessionId || !newName) return;

    chrome.storage.sync.get("sessions", (data) => {
        const sessions = Array.isArray(data.sessions) ? data.sessions : [];

        const target = sessions.find(s => s.id === sessionId);
        if (!target) return;

        target.name = newName;

        chrome.storage.sync.set({ sessions }, () => {
            sendResponse({ success: true });
        });
    });
}

function isSavableUrl(url) {
    if (!url) return false;

    // chrome://, about:, edge://, brave:// 등 브라우저 내부 페이지 제외
    if (
        url.startsWith("chrome://") ||
        url.startsWith("about:") ||
        url.startsWith("edge://") ||
        url.startsWith("brave://")
    ) {
        return false;
    }

    // http, https, file 프로토콜 허용
    return (
        url.startsWith("http://") ||
        url.startsWith("https://") ||
        url.startsWith("file://")
    );
}
