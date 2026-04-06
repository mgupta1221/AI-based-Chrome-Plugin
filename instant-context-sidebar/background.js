// Use browser namespace if available (Firefox), otherwise chrome (Chrome)
const api = typeof browser !== "undefined" ? browser : chrome;

// Toggle sidebar when toolbar icon is clicked (no popup now)
api.action.onClicked.addListener((tab) => {
  if (tab.id) {
    api.tabs.sendMessage(tab.id, { action: "toggle-sidebar" });
  }
});

// Toggle sidebar when the keyboard shortcut is pressed
api.commands.onCommand.addListener((command) => {
  if (command === "toggle-sidebar") {
    api.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        api.tabs.sendMessage(tabs[0].id, { action: "toggle-sidebar" });
      }
    });
  }
});
