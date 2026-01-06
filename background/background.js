/**
 * Popup에서 전달되는 메시지를 처리하는 진입점
 * - SAVE_TABS    : 현재 창의 탭 URL 저장
 * - RESTORE_TABS : 저장된 탭 복원
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SAVE_TABS") {
    saveTabs(sendResponse);
    return true; // sendResponse를 비동기로 사용하기 위해 필요
  }

  if (message.type === "RESTORE_TABS") {
    restoreTabs(message.openInNewWindow);
  }
});

/**
 * 현재 창에 열려 있는 탭들을 저장한다.
 * - http / https URL만 저장
 * - chrome://, about:blank 등 내부 페이지는 제외
 * - 저장 완료 후 저장된 탭 개수를 popup으로 반환
 */
function saveTabs(sendResponse) {
  chrome.tabs.query({ currentWindow: true }, (tabs) => {
    const urls = tabs
      .map(tab => tab.url)
      .filter(
        url =>
          url.startsWith("http://") ||
          url.startsWith("https://")
      );

    chrome.storage.local.set({ savedTabs: urls }, () => {
      sendResponse({ count: urls.length });
    });
  });
}

/**
 * 저장된 탭을 복원한다.
 * @param {boolean} openInNewWindow
 *  - true  : 새 Chrome 창에서 복원
 *  - false : 현재 창에서 복원
 */
function restoreTabs(openInNewWindow) {
  chrome.storage.local.get("savedTabs", (data) => {
    if (!data.savedTabs || data.savedTabs.length === 0) return;

    if (openInNewWindow) {
      restoreInNewWindow(data.savedTabs);
    } else {
      restoreInCurrentWindow(data.savedTabs);
    }
  });
}

/**
 * 현재 창에서 탭을 복원한다.
 * - Chrome 재실행 직후의 "새 탭 1개" 상태라면 해당 탭을 제거
 * - 이후 저장된 URL들을 새 탭으로 추가
 */
function restoreInCurrentWindow(urls) {
  chrome.tabs.query({ currentWindow: true }, (tabs) => {
    // 새 창 + 새 탭 1개 상태면 기본 새 탭 제거
    if (
      tabs.length === 1 &&
      tabs[0].url === "chrome://newtab/"
    ) {
      chrome.tabs.remove(tabs[0].id);
    }

    urls.forEach(url => {
      chrome.tabs.create({ url });
    });
  });
}

/**
 * 새 Chrome 창을 생성한 뒤, 해당 창에서 탭을 복원한다.
 * - Chrome이 자동으로 생성한 첫 탭을 재사용
 * - 첫 URL은 기존 탭을 update
 * - 나머지 URL은 새 탭으로 생성
 *
 * ※ 모든 탭을 제거하면 Chrome 내부 로직과 충돌할 수 있으므로
 *    반드시 첫 탭은 유지한다.
 */
function restoreInNewWindow(urls) {
  chrome.windows.create({}, (newWindow) => {
    chrome.tabs.query({ windowId: newWindow.id }, (tabs) => {
      const firstTab = tabs[0];

      // 첫 탭을 첫 번째 URL로 교체
      chrome.tabs.update(firstTab.id, { url: urls[0] });

      // 나머지 URL은 새 탭으로 생성
      urls.slice(1).forEach(url => {
        chrome.tabs.create({
          windowId: newWindow.id,
          url
        });
      });
    });
  });
}
