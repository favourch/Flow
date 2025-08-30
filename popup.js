class FlowPopup {
    constructor() {
        this.isRunning = false;
        this.isPaused = false;
        this.currentProgress = 0;
        this.initializeElements();
        this.bindEvents();
        this.loadSettings();
    }

    initializeElements() {
        this.elements = {
            textInput: document.getElementById('text-input'),
            pasteBtn: document.getElementById('paste-btn'),
            wpmSlider: document.getElementById('wpm-slider'),
            wpmValue: document.getElementById('wpm-value'),
            preserveFormatting: document.getElementById('preserve-formatting'),
            naturalVariations: document.getElementById('natural-variations'),
            typoSimulation: document.getElementById('typo-simulation'),
            startBtn: document.getElementById('start-btn'),
            stopBtn: document.getElementById('stop-btn'),
            pauseBtn: document.getElementById('pause-btn'),
            status: document.getElementById('status'),
            progressContainer: document.getElementById('progress-container'),
            progressFill: document.getElementById('progress-fill'),
            progressText: document.getElementById('progress-text')
        };
    }

    bindEvents() {
        // WPM slider
        this.elements.wpmSlider.addEventListener('input', (e) => {
            this.elements.wpmValue.textContent = e.target.value;
            this.saveSettings();
        });

        // Paste button
        this.elements.pasteBtn.addEventListener('click', async () => {
            try {
                const text = await navigator.clipboard.readText();
                this.elements.textInput.value = text;
                this.updateStatus('Text pasted! Now click in Google Docs where you want to start typing.', 'idle');
            } catch (err) {
                this.updateStatus('Failed to read clipboard. Please paste manually.', 'error');
            }
        });

        // Control buttons
        this.elements.startBtn.addEventListener('click', () => this.startFlow());
        this.elements.stopBtn.addEventListener('click', () => this.stopFlow());
        this.elements.pauseBtn.addEventListener('click', () => this.togglePause());

        // Save settings on change
        [this.elements.preserveFormatting, this.elements.naturalVariations, this.elements.typoSimulation]
            .forEach(el => el.addEventListener('change', () => this.saveSettings()));

        // Listen for messages from content script
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            this.handleMessage(message, sender, sendResponse);
        });
    }

    async startFlow() {
        const text = this.elements.textInput.value.trim();
        if (!text) {
            this.updateStatus('Please enter some text to type', 'error');
            return;
        }

        // Check if we're on a Google Docs page
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab.url.includes('docs.google.com')) {
            this.updateStatus('Please open Google Docs first', 'error');
            return;
        }

        const settings = {
            text: text,
            wpm: parseInt(this.elements.wpmSlider.value),
            preserveFormatting: this.elements.preserveFormatting.checked,
            naturalVariations: this.elements.naturalVariations.checked,
            typoSimulation: this.elements.typoSimulation.checked
        };

        try {
            // Update status to inform user about focus handling
            this.updateStatus('Starting Flow... Make sure you clicked in Google Docs first!', 'running');
            
            // Send message to content script
            await chrome.tabs.sendMessage(tab.id, {
                action: 'startTyping',
                settings: settings
            });

            this.isRunning = true;
            this.isPaused = false;
            this.updateUI();
            this.updateStatus('Flow is typing! Watch Google Docs...', 'running');
            this.elements.progressContainer.classList.remove('hidden');
        } catch (err) {
            this.updateStatus('Failed to start. Make sure Google Docs is loaded and you clicked in the document.', 'error');
        }
    }

    async stopFlow() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        try {
            await chrome.tabs.sendMessage(tab.id, { action: 'stopTyping' });
        } catch (err) {
            console.log('Content script not available');
        }

        this.isRunning = false;
        this.isPaused = false;
        this.currentProgress = 0;
        this.updateUI();
        this.updateStatus('Flow stopped', 'idle');
        this.elements.progressContainer.classList.add('hidden');
        this.updateProgress(0, 0, 0);
    }

    async togglePause() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        try {
            await chrome.tabs.sendMessage(tab.id, { 
                action: this.isPaused ? 'resumeTyping' : 'pauseTyping' 
            });
            this.isPaused = !this.isPaused;
            this.updateUI();
            this.updateStatus(this.isPaused ? 'Flow paused' : 'Flow resumed', this.isPaused ? 'paused' : 'running');
        } catch (err) {
            this.updateStatus('Failed to pause/resume', 'error');
        }
    }

    handleMessage(message, sender, sendResponse) {
        switch (message.action) {
            case 'updateProgress':
                this.updateProgress(message.current, message.total, message.percentage);
                break;
            case 'typingComplete':
                this.isRunning = false;
                this.isPaused = false;
                this.updateUI();
                this.updateStatus('Flow completed successfully!', 'idle');
                this.elements.progressContainer.classList.add('hidden');
                break;
            case 'typingError':
                this.isRunning = false;
                this.isPaused = false;
                this.updateUI();
                this.updateStatus(`Error: ${message.error}`, 'error');
                break;
            case 'typingStopped':
                this.isRunning = false;
                this.isPaused = false;
                this.updateUI();
                this.updateStatus('Flow stopped', 'idle');
                this.elements.progressContainer.classList.add('hidden');
                break;
        }
    }

    updateUI() {
        this.elements.startBtn.disabled = this.isRunning;
        this.elements.stopBtn.disabled = !this.isRunning;
        this.elements.pauseBtn.disabled = !this.isRunning;
        this.elements.pauseBtn.textContent = this.isPaused ? '▶️ Resume' : '⏸️ Pause';
        this.elements.textInput.disabled = this.isRunning;
    }

    updateStatus(message, type) {
        this.elements.status.textContent = message;
        this.elements.status.className = `status-${type}`;
    }

    updateProgress(current, total, percentage) {
        this.elements.progressFill.style.width = `${percentage}%`;
        this.elements.progressText.textContent = `${Math.round(percentage)}% complete (${current}/${total} characters)`;
    }

    saveSettings() {
        const settings = {
            wpm: parseInt(this.elements.wpmSlider.value),
            preserveFormatting: this.elements.preserveFormatting.checked,
            naturalVariations: this.elements.naturalVariations.checked,
            typoSimulation: this.elements.typoSimulation.checked
        };
        chrome.storage.sync.set({ flowSettings: settings });
    }

    async loadSettings() {
        try {
            const result = await chrome.storage.sync.get(['flowSettings']);
            if (result.flowSettings) {
                const settings = result.flowSettings;
                this.elements.wpmSlider.value = settings.wpm || 60;
                this.elements.wpmValue.textContent = settings.wpm || 60;
                this.elements.preserveFormatting.checked = settings.preserveFormatting !== false;
                this.elements.naturalVariations.checked = settings.naturalVariations || false;
                this.elements.typoSimulation.checked = settings.typoSimulation || false;
            }
        } catch (err) {
            console.log('Failed to load settings:', err);
        }
    }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new FlowPopup();
});
