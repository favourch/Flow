// Background script for Flow Chrome Extension
class FlowBackground {
    constructor() {
        this.setupListeners();
    }

    setupListeners() {
        // Handle extension installation
        chrome.runtime.onInstalled.addListener((details) => {
            if (details.reason === 'install') {
                console.log('Flow extension installed');
                this.setDefaultSettings();
            } else if (details.reason === 'update') {
                console.log('Flow extension updated');
            }
        });

        // Handle messages from popup and content scripts
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            this.handleMessage(message, sender, sendResponse);
            return true; // Keep the message channel open for async responses
        });

        // Handle tab updates to inject content script if needed
        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            if (changeInfo.status === 'complete' && tab.url && tab.url.includes('docs.google.com')) {
                // Ensure content script is injected
                this.ensureContentScript(tabId);
            }
        });
    }

    async setDefaultSettings() {
        const defaultSettings = {
            wpm: 60,
            preserveFormatting: true,
            naturalVariations: false,
            typoSimulation: false
        };

        try {
            await chrome.storage.sync.set({ flowSettings: defaultSettings });
            console.log('Default settings saved');
        } catch (err) {
            console.error('Failed to save default settings:', err);
        }
    }

    handleMessage(message, sender, sendResponse) {
        switch (message.action) {
            case 'getSettings':
                this.getSettings().then(sendResponse);
                break;
            case 'saveSettings':
                this.saveSettings(message.settings).then(sendResponse);
                break;
            case 'checkGoogleDocs':
                this.checkGoogleDocs(sender.tab?.id).then(sendResponse);
                break;
            default:
                sendResponse({ success: false, error: 'Unknown action' });
        }
    }

    async getSettings() {
        try {
            const result = await chrome.storage.sync.get(['flowSettings']);
            return { success: true, settings: result.flowSettings || {} };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    async saveSettings(settings) {
        try {
            await chrome.storage.sync.set({ flowSettings: settings });
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    async checkGoogleDocs(tabId) {
        if (!tabId) return { success: false, error: 'No tab ID' };

        try {
            const tab = await chrome.tabs.get(tabId);
            const isGoogleDocs = tab.url && tab.url.includes('docs.google.com');
            return { success: true, isGoogleDocs };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    async ensureContentScript(tabId) {
        try {
            // Try to ping the content script
            await chrome.tabs.sendMessage(tabId, { action: 'ping' });
        } catch (err) {
            // Content script not available, inject it
            try {
                await chrome.scripting.executeScript({
                    target: { tabId },
                    files: ['content.js']
                });
                console.log('Content script injected into tab', tabId);
            } catch (injectErr) {
                console.error('Failed to inject content script:', injectErr);
            }
        }
    }
}

// Initialize background script
new FlowBackground();
