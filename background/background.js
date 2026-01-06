/**
 * Popup에서 전달되는 메시지를 처리하는 진입점
 * - SAVE_SESSION   : 현재 창의 탭 URL을 "세션"으로 저장
 * - RESTORE_SESSION: 특정 세션을 복원
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "SAVE_SESSION") {
        saveSession(sendResponse);
        return true; // sendResponse를 비동기로 사용하기 위해 필요
    }

    if (message.type === "RESTORE_SESSION") {
        restoreSession(message.sessionId, message.openInNewWindow);
    }
});

/**
 * 현재 창에 열려 있는 탭들을 세션으로 저장한다.
 * - http/https URL만 저장 (chrome://, about:blank 등 제외)
 * - sessions[] 배열에 새 항목을 추가
 * - 저장 완료 후 {count, session}을 popup으로 반환
 */
function saveSession(sendResponse) {
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
        const urls = tabs
            .map((tab) => tab.url)
            .filter(
                (url) => url.startsWith("http://") || url.startsWith("https://")
            );

        chrome.storage.local.get("sessions", (data) => {
            const sessions = Array.isArray(data.sessions) ? data.sessions : [];

            const createdAt = Date.now();
            const session = {
                id: `sess_${createdAt}`,
                name: formatSessionName(createdAt),
                createdAt,
                urls
            };

            // 최신 세션이 위로 오도록 앞에 추가
            sessions.unshift(session);

            chrome.storage.local.set({ sessions }, () => {
                sendResponse({ count: urls.length, session });
            });
        });
    });
}

/**
 * 특정 세션을 복원한다.
 * @param {string} sessionId
 * @param {boolean} openInNewWindow
 */
function restoreSession(sessionId, openInNewWindow) {
    if (!sessionId) return;

    chrome.storage.local.get("sessions", (data) => {
        const sessions = Array.isArray(data.sessions) ? data.sessions : [];
        const session = sessions.find((s) => s.id === sessionId);
        if (!session || !Array.isArray(session.urls) || session.urls.length === 0) return;

        if (openInNewWindow) {
            restoreInNewWindow(session.urls);
        } else {
            restoreInCurrentWindow(session.urls);
        }
    });
}

/**
 * 현재 창에서 탭을 복원한다.
 * - Chrome 재실행 직후 "새 탭 1개" 상태라면 해당 탭을 제거
 * - 이후 URL들을 새 탭으로 추가
 */
function restoreInCurrentWindow(urls) {
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
        if (tabs.length === 1 && tabs[0].url === "chrome://newtab/") {
            chrome.tabs.remove(tabs[0].id);
        }

        urls.forEach((url) => {
            chrome.tabs.create({ url });
        });
    });
}

/**
 * 새 Chrome 창을 생성한 뒤, 해당 창에서 탭을 복원한다.
 * - Chrome이 자동으로 생성한 첫 탭을 재사용 (삭제하면 불안정해질 수 있음)
 */
function restoreInNewWindow(urls) {
    chrome.windows.create({}, (newWindow) => {
        chrome.tabs.query({ windowId: newWindow.id }, (tabs) => {
            const firstTab = tabs[0];

            // 첫 탭을 첫 URL로 교체
            chrome.tabs.update(firstTab.id, { url: urls[0] });

            // 나머지는 새 탭으로
            urls.slice(1).forEach((url) => {
                chrome.tabs.create({
                    windowId: newWindow.id,
                    url
                });
            });
        });
    });
}

/**
 * 세션 이름(자동 생성): YYYY-MM-DD HH:mm
 */
function formatSessionName(timestamp) {
    const d = new Date(timestamp);

    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");

    return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}
