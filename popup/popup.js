/**
 * 저장 결과를 사용자에게 보여주기 위한 상태 메시지
 */
const status = document.getElementById("status");

/**
 * "새 창에서 복원" 옵션 체크박스
 */
const checkbox = document.getElementById("newWindowCheckbox");

/**
 * 세션 목록 UI
 */
const sessionList = document.getElementById("sessionList");
const emptyHint = document.getElementById("emptyHint");

/**
 * popup 로드 시:
 * - 체크박스 상태 복원
 * - 세션 목록 렌더링
 */
chrome.storage.local.get("openInNewWindow", (data) => {
    checkbox.checked = Boolean(data.openInNewWindow);
});

renderSessionList();

/**
 * 체크박스 상태 변경 시 local storage에 저장
 */
checkbox.addEventListener("change", () => {
    chrome.storage.local.set({
        openInNewWindow: checkbox.checked
    });
});

/**
 * [현재 탭 저장] 버튼 클릭
 * - background에 저장 요청
 * - 저장 완료 메시지 표시
 * - 세션 목록 갱신
 */
document.getElementById("saveBtn").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "SAVE_SESSION" }, (response) => {
        if (!response) return;

        status.textContent = `탭 ${response.count}개 저장됨`;
        status.classList.remove("hidden");

        setTimeout(() => {
            status.classList.add("hidden");
        }, 2000);

        renderSessionList();
    });
});

/**
 * 세션 목록을 렌더링한다.
 * - sessions가 없으면 빈 상태 메시지 표시
 * - 각 세션에 [열기] 버튼 제공
 */
function renderSessionList() {
    chrome.storage.local.get("sessions", (data) => {
        const sessions = Array.isArray(data.sessions) ? data.sessions : [];

        if (sessions.length === 0) {
            sessionList.innerHTML = "";
            emptyHint.classList.remove("hidden");
            return;
        }

        emptyHint.classList.add("hidden");

        sessionList.innerHTML = sessions
            .map((s) => {
                const count = Array.isArray(s.urls) ? s.urls.length : 0;
                const safeName = escapeHtml(s.name || "Untitled");
                const safeId = escapeHtml(s.id);

                return `
          <li>
            <div class="sessionName">
              ${safeName}
              <span class="sessionMeta">(${count})</span>
            </div>
            <button class="openBtn" data-session-id="${safeId}">열기</button>
          </li>
        `;
            })
            .join("");

        // 리스트 렌더 후 버튼 이벤트 바인딩
        sessionList.querySelectorAll(".openBtn").forEach((btn) => {
            btn.addEventListener("click", onClickOpenSession);
        });
    });
}

/**
 * [열기] 버튼 클릭 처리
 * - 현재 저장된 옵션(openInNewWindow)을 함께 전달
 */
function onClickOpenSession(e) {
    const sessionId = e.currentTarget.dataset.sessionId;

    chrome.storage.local.get("openInNewWindow", (data) => {
        chrome.runtime.sendMessage({
            type: "RESTORE_SESSION",
            sessionId,
            openInNewWindow: Boolean(data.openInNewWindow)
        });
    });
}

/**
 * 간단한 HTML 이스케이프 (popup 렌더 안전용)
 */
function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
