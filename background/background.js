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

const DELETE_UNDO_MS = 3000;
const PENDING_SESSION_DELETES_KEY = "pendingSessionDeletes";
const pendingSessionDeletes = new Map();

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

    if (message.type === "RESTORE_URL") {
        restoreUrl(message.url);
    }

    if (message.type === "DELETE_SESSION") {
        deleteSession(message.sessionId, sendResponse);
        return true;
    }

    if (message.type === "SCHEDULE_DELETE_SESSION") {
        scheduleDeleteSession(message.sessionId);
    }

    if (message.type === "CANCEL_DELETE_SESSION") {
        cancelDeleteSession(message.sessionId);
    }

    if (message.type === "GET_PENDING_SESSION_DELETES") {
        getPendingSessionDeletes(sendResponse);
        return true;
    }

    if (message.type === "DELETE_URL") {
        deleteUrl(message.sessionId, message.url, sendResponse, message.index);
        return true;
    }

});

function scheduleDeleteSession(sessionId) {
    if (!sessionId) return;

    clearDeleteTimer(sessionId);
    const dueAt = Date.now() + DELETE_UNDO_MS;

    chrome.storage.local.get(PENDING_SESSION_DELETES_KEY, (data) => {
        const pending = data[PENDING_SESSION_DELETES_KEY] || {};
        pending[sessionId] = dueAt;
        chrome.storage.local.set({ [PENDING_SESSION_DELETES_KEY]: pending }, () => {
            startDeleteTimer(sessionId, dueAt);
        });
    });
}

function cancelDeleteSession(sessionId) {
    clearDeleteTimer(sessionId);

    chrome.storage.local.get(PENDING_SESSION_DELETES_KEY, (data) => {
        const pending = data[PENDING_SESSION_DELETES_KEY] || {};
        delete pending[sessionId];
        chrome.storage.local.set({ [PENDING_SESSION_DELETES_KEY]: pending });
    });
}

function getPendingSessionDeletes(sendResponse) {
    chrome.storage.local.get(PENDING_SESSION_DELETES_KEY, (data) => {
        const pending = data[PENDING_SESSION_DELETES_KEY] || {};
        const now = Date.now();
        const active = {};
        const expiredSessionIds = [];

        Object.entries(pending).forEach(([sessionId, dueAt]) => {
            if (dueAt <= now) {
                expiredSessionIds.push(sessionId);
                return;
            }

            active[sessionId] = dueAt;
            startDeleteTimer(sessionId, dueAt);
        });

        const respond = () => {
            chrome.storage.local.set({ [PENDING_SESSION_DELETES_KEY]: active }, () => {
                sendResponse(active);
            });
        };

        if (!expiredSessionIds.length) {
            respond();
            return;
        }

        let remainingDeletes = expiredSessionIds.length;
        expiredSessionIds.forEach((sessionId) => {
            deleteSession(sessionId, () => {
                remainingDeletes -= 1;
                if (remainingDeletes === 0) {
                    respond();
                }
            });
        });
    });
}

function startDeleteTimer(sessionId, dueAt) {
    clearDeleteTimer(sessionId);

    const delay = Math.max(0, dueAt - Date.now());
    const timer = setTimeout(() => {
        removePendingSessionDelete(sessionId, () => {
            deleteSession(sessionId, () => {});
        });
    }, delay);

    pendingSessionDeletes.set(sessionId, timer);
}

function clearDeleteTimer(sessionId) {
    const timer = pendingSessionDeletes.get(sessionId);
    if (!timer) return;

    clearTimeout(timer);
    pendingSessionDeletes.delete(sessionId);
}

function removePendingSessionDelete(sessionId, done) {
    clearDeleteTimer(sessionId);

    chrome.storage.local.get(PENDING_SESSION_DELETES_KEY, (data) => {
        const pending = data[PENDING_SESSION_DELETES_KEY] || {};
        delete pending[sessionId];
        chrome.storage.local.set({ [PENDING_SESSION_DELETES_KEY]: pending }, () => {
            done?.();
        });
    });
}

/**
 * 현재 창의 탭을 세션으로 저장
 */
function saveSession(sendResponse, nameFromPopup) {
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
        const urls = tabs
            .map(tab => {
                const url = tab.url || tab.pendingUrl;
                const originalUrl = extractOriginalUrl(url);
                if (!isSavableUrl(originalUrl)) return null;

                return {
                    url: originalUrl,
                    title: tab.title || originalUrl
                };
            })
            .filter(Boolean);

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
                if (chrome.runtime.lastError) {
                    console.error("Storage Error:", chrome.runtime.lastError);
                    sendResponse({
                        success: false,
                        reason: "STORAGE_ERROR"
                    });
                    return;
                }
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
        const urls = getSessionUrls(session);
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
            if (chrome.runtime.lastError) {
                console.error("Storage Error:", chrome.runtime.lastError);
                sendResponse({ success: false, reason: "STORAGE_ERROR" });
                return;
            }
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
                target.urls = target.urls.filter(u => getSavedUrl(u) !== url);
            }
            
            // 만약 세션 내 탭이 하나도 남지 않았다면 세션 자체를 삭제
            const nextSessions = target.urls.length === 0 
                ? sessions.filter(s => s.id !== sessionId)
                : sessions;

            chrome.storage.sync.set({ sessions: nextSessions }, () => {
                if (chrome.runtime.lastError) {
                    console.error("Storage Error:", chrome.runtime.lastError);
                    sendResponse({ success: false, reason: "STORAGE_ERROR" });
                    return;
                }
                sendResponse({ success: true });
            });
        } else {
            sendResponse({ success: false });
        }
    });
}

/* ---------- 복원 로직 ---------- */

function restoreInCurrentWindow(urls) {
    checkFileAccess(urls, (allowed) => {
        chrome.tabs.query({ currentWindow: true }, (tabs) => {
            if (tabs.length === 1 && tabs[0].url === "chrome://newtab/") {
                chrome.tabs.remove(tabs[0].id);
            }
            const firstRestorableIndex = urls.findIndex(url => !url.startsWith("file://") || allowed);
            urls.forEach((url, index) => {
                if (url.startsWith("file://") && !allowed) {
                    notifyFileAccessError();
                    return;
                }
                chrome.tabs.create({ url, active: index === firstRestorableIndex }, (tab) => {
                    if (url.startsWith("file://")) {
                        monitorFileTab(tab.id, url);
                    }
                });
            });
        });
    });
}

function restoreInNewWindow(urls) {
    checkFileAccess(urls, (allowed) => {
        chrome.windows.create({}, (newWindow) => {
            chrome.tabs.query({ windowId: newWindow.id }, (tabs) => {
                const firstUrl = urls[0];
                const isFirstFile = firstUrl.startsWith("file://");

                if (isFirstFile && !allowed) {
                    notifyFileAccessError();
                } else {
                    chrome.tabs.update(tabs[0].id, { url: firstUrl }, (tab) => {
                        if (isFirstFile) monitorFileTab(tab.id, firstUrl);
                    });
                }

                urls.slice(1).forEach(url => {
                    if (url.startsWith("file://") && !allowed) {
                        notifyFileAccessError();
                        return;
                    }
                    chrome.tabs.create({ windowId: newWindow.id, url, active: false }, (tab) => {
                        if (url.startsWith("file://")) {
                            monitorFileTab(tab.id, url);
                        }
                    });
                });
                chrome.windows.update(newWindow.id, { focused: true });
            });
        });
    });
}

/**
 * 개별 URL 복원
 */
function restoreUrl(url) {
    if (url.startsWith("file://")) {
        chrome.extension.isAllowedFileSchemeAccess((allowed) => {
            if (!allowed) {
                notifyFileAccessError();
            } else {
                chrome.tabs.create({ url }, (tab) => {
                    monitorFileTab(tab.id, url);
                });
            }
        });
    } else {
        chrome.tabs.create({ url });
    }
}

/**
 * 로컬 파일 권한 확인
 */
function checkFileAccess(urls, callback) {
    const hasFileUrl = urls.some(url => url.startsWith("file://"));
    if (hasFileUrl) {
        chrome.extension.isAllowedFileSchemeAccess(callback);
    } else {
        callback(true);
    }
}

/**
 * 파일 접근 권한 부족 알림
 */
function notifyFileAccessError() {
    chrome.runtime.sendMessage({
        type: "SHOW_TOAST",
        message: chrome.i18n.getMessage("fileAccessDenied"),
        toastType: "error"
    });
}

/**
 * 파일 탭 로딩 상태 모니터링
 */
function monitorFileTab(tabId, url) {
    const listener = (updatedTabId, changeInfo, tab) => {
        if (updatedTabId === tabId && changeInfo.status === "complete") {
            // 로컬 파일의 경우 존재하지 않으면 title이 파일명이 아니거나, 
            // URL이 chrome-error:// 등으로 리다이렉트될 수 있음
            // 하지만 크롬 버전에 따라 동작이 다를 수 있으므로 
            // 가장 확실한 방법 중 하나는 삽입된 스크립트가 실행되는지 확인하는 것이나
            // file:// 에서는 스크립트 실행도 제한될 수 있음.
            // 여기서는 단순하게 title이나 url 변화를 체크해볼 수 있음.
            
            if (tab.url.startsWith("chrome-error://")) {
                chrome.runtime.sendMessage({
                    type: "SHOW_TOAST",
                    message: chrome.i18n.getMessage("fileNotFound", [url.replace("file:///", "")]),
                    toastType: "error"
                });
                chrome.tabs.onUpdated.removeListener(listener);
            }
        }
    };
    chrome.tabs.onUpdated.addListener(listener);
    
    // 5초 후에는 리스너 제거 (타임아웃)
    setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
    }, 5000);
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

/**
 * PDF 뷰어 등 특수 URL에서 실제 URL을 추출
 */
function extractOriginalUrl(url) {
    if (!url) return url;

    // 크롬 내장 PDF 뷰어 또는 common pdf.js 기반 뷰어 처리
    if (url.startsWith("chrome-extension://") && isPdfViewerUrl(url)) {
        try {
            const urlObj = new URL(url);
            const originalUrl = urlObj.searchParams.get("file") || urlObj.searchParams.get("src");
            if (isRestorableUrl(originalUrl)) {
                return originalUrl;
            }
        } catch (e) {
            // ignore
        }
    }
    return url;
}

function isPdfViewerUrl(url) {
    return (
        url.includes("viewer.html") ||
        url.includes("pdf.js") ||
        url.includes("mhjfbmdgcfjbbpaeojofohoefgiehjai")
    );
}

function isRestorableUrl(url) {
    return Boolean(url) && (
        url.startsWith("http://") ||
        url.startsWith("https://") ||
        url.startsWith("file://")
    );
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

    // http, https, file, chrome-extension, view-source 프로토콜 허용
    // chrome-extension://은 크롬 내장 PDF 뷰어 등을 위해 허용
    return (
        url.startsWith("http://") ||
        url.startsWith("https://") ||
        url.startsWith("file://") ||
        url.startsWith("chrome-extension://") ||
        url.startsWith("view-source:")
    );
}
