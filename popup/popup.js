/**
 * 저장/복원 결과를 사용자에게 보여주기 위한 상태 메시지 영역
 */
const status = document.getElementById("status");

/**
 * "마지막 저장" 도메인 리스트 UI
 */
const savedSection = document.getElementById("savedSection");
const savedDomains = document.getElementById("savedDomains");

/**
 * "새 창에서 복원" 옵션 체크박스
 */
const checkbox = document.getElementById("newWindowCheckbox");

/**
 * URL에서 도메인만 추출한다.
 * - URL 파싱 실패 시 빈 문자열 반환
 */
function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/**
 * 저장된 탭 목록(savedTabs)을 읽어서 도메인 리스트를 갱신한다.
 * - 도메인 중복 제거
 * - 빈 값 제거
 */
function renderSavedDomains() {
    chrome.storage.local.get("savedTabs", (data) => {
        const urls = Array.isArray(data.savedTabs) ? data.savedTabs : [];

        const domainCountMap = {};

        urls.forEach((url) => {
            const domain = getDomain(url);
            if (!domain) return;

            domainCountMap[domain] = (domainCountMap[domain] || 0) + 1;
        });

        const entries = Object.entries(domainCountMap);

        if (entries.length === 0) {
            savedSection.classList.add("hidden");
            savedDomains.innerHTML = "";
            return;
        }

        savedDomains.innerHTML = entries
            .map(([domain, count]) => `<li>${domain} (${count})</li>`)
            .join("");

        savedSection.classList.remove("hidden");
    });
}

/**
 * popup 로드 시:
 * - 체크박스 상태 복원
 * - 마지막 저장 목록 표시
 */
chrome.storage.local.get("openInNewWindow", (data) => {
  checkbox.checked = Boolean(data.openInNewWindow);
});

renderSavedDomains();

/**
 * 체크박스 상태 변경 시 local storage에 저장
 */
checkbox.addEventListener("change", () => {
  chrome.storage.local.set({
    openInNewWindow: checkbox.checked
  });
});

/**
 * [현재 탭 저장] 버튼 클릭 처리
 * - background로 저장 요청 전송
 * - 저장 완료 메시지 표시
 * - 저장된 도메인 리스트 즉시 갱신
 */
document.getElementById("saveBtn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "SAVE_TABS" }, (response) => {
    if (!response) return;

    status.textContent = `탭 ${response.count}개 저장됨`;
    status.classList.remove("hidden");

    setTimeout(() => {
      status.classList.add("hidden");
    }, 2000);

    // 저장 직후 목록 갱신
    renderSavedDomains();
  });
});

/**
 * [탭 다시 열기] 버튼 클릭 처리
 * - 저장된 옵션(openInNewWindow)과 함께 복원 요청을 전달
 */
document.getElementById("restoreBtn").addEventListener("click", () => {
  chrome.storage.local.get("openInNewWindow", (data) => {
    chrome.runtime.sendMessage({
      type: "RESTORE_TABS",
      openInNewWindow: Boolean(data.openInNewWindow)
    });
  });
});
