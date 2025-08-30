class FlowTypingEngine {
    constructor() {
        this.isTyping = false;
        this.isPaused = false;
        this.currentPosition = 0;
        this.textToType = '';
        this.settings = {};
        this.typingTimeout = null;
        this.editor = null;
        this.setupMessageListener();
    }

    setupMessageListener() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            switch (message.action) {
                case 'ping':
                    sendResponse({ success: true });
                    break;
                case 'startTyping':
                    this.startTyping(message.settings);
                    sendResponse({ success: true });
                    break;
                case 'stopTyping':
                    this.stopTyping();
                    sendResponse({ success: true });
                    break;
                case 'pauseTyping':
                    this.pauseTyping();
                    sendResponse({ success: true });
                    break;
                case 'resumeTyping':
                    this.resumeTyping();
                    sendResponse({ success: true });
                    break;
            }
        });
    }

    findGoogleDocsEditor() {
        console.log('Flow: Searching for Google Docs editor...');
        
        // Google Docs uses a canvas-based editor with hidden input elements
        // Let's look for the actual input handlers and iframe elements
        const selectors = [
            // Primary targets - these are the actual input elements
            '.docs-texteventtarget-iframe',
            'iframe[title="Rich text editor main content area"]',
            '.kix-appview-editor iframe',
            
            // Secondary targets - contenteditable areas
            '[contenteditable="true"]',
            '.docs-text-editor',
            
            // Canvas and container elements (for focus/click detection)
            '.kix-canvas-tile-content',
            '.kix-page-content-wrap',
            '.kix-page-column-content',
            '.kix-appview-editor',
            '.kix-page-paginated'
        ];

        // First, try to find iframe-based editors (most reliable for typing)
        for (let i = 0; i < 3; i++) {
            const selector = selectors[i];
            const elements = document.querySelectorAll(selector);
            console.log(`Flow: Found ${elements.length} elements for selector: ${selector}`);
            
            for (const element of elements) {
                console.log('Flow: Checking iframe/input element:', element);
                if (element.tagName === 'IFRAME') {
                    try {
                        // Try to access iframe content
                        const iframeDoc = element.contentDocument || element.contentWindow.document;
                        if (iframeDoc) {
                            console.log('Flow: Found accessible iframe editor:', element);
                            return element;
                        }
                    } catch (e) {
                        console.log('Flow: Iframe not accessible, using as fallback:', element);
                        return element;
                    }
                } else if (this.isValidEditor(element)) {
                    console.log('Flow: Valid input element found:', element);
                    return element;
                }
            }
        }

        // Then try contenteditable elements
        const editableElements = document.querySelectorAll('[contenteditable="true"]');
        console.log(`Flow: Found ${editableElements.length} contenteditable elements`);
        
        for (const element of editableElements) {
            console.log('Flow: Checking contenteditable element:', element, 'valid:', this.isValidEditor(element), 'inMainContent:', this.isInMainContent(element));
            if (this.isValidEditor(element) && this.isInMainContent(element)) {
                console.log('Flow: Using contenteditable element as editor:', element);
                return element;
            }
        }

        // Fallback: use canvas or container elements for focus/click detection
        // These won't receive text directly but can be used for focusing
        for (let i = 5; i < selectors.length; i++) {
            const selector = selectors[i];
            const elements = document.querySelectorAll(selector);
            console.log(`Flow: Found ${elements.length} elements for selector: ${selector}`);
            
            for (const element of elements) {
                if (element.offsetWidth > 0 && element.offsetHeight > 0) {
                    console.log('Flow: Using container element for focus:', element, 'selector:', selector);
                    return element;
                }
            }
        }

        // Very last resort: try to find document body as focus target
        console.log('Flow: Using document.body as fallback');
        return document.body;
    }

    isValidEditor(element) {
        return element && 
               element.offsetParent && 
               element.offsetHeight > 0 && 
               element.offsetWidth > 0 &&
               !element.classList.contains('docs-material') && // Avoid UI elements
               !element.closest('.docs-material');
    }

    isInMainContent(element) {
        // Check if element is in the main document area
        return element.closest('.kix-page-content-wrap') || 
               element.closest('.kix-appview-editor') ||
               element.closest('[role="textbox"]');
    }

    async ensureEditorFocus() {
        if (!this.editor) return;

        // Method 1: Direct focus
        this.editor.focus();

        // Method 2: Click to ensure focus (simulates user interaction)
        const rect = this.editor.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        // Simulate click event
        const clickEvent = new MouseEvent('click', {
            view: window,
            bubbles: true,
            cancelable: true,
            clientX: centerX,
            clientY: centerY
        });
        this.editor.dispatchEvent(clickEvent);

        // Method 3: Try focusing any parent elements that might be focusable
        let parent = this.editor.parentElement;
        while (parent && parent !== document.body) {
            if (parent.getAttribute('contenteditable') === 'true' || parent.tabIndex >= 0) {
                parent.focus();
                break;
            }
            parent = parent.parentElement;
        }

        // Method 4: Ensure cursor is positioned
        const selection = window.getSelection();
        if (selection.rangeCount === 0) {
            const range = document.createRange();
            range.selectNodeContents(this.editor);
            range.collapse(false); // Collapse to end
            selection.removeAllRanges();
            selection.addRange(range);
        }

        // Give a moment for focus to take effect
        await new Promise(resolve => setTimeout(resolve, 50));
    }

    async startTyping(settings) {
        this.settings = settings;
        
        // Process text based on formatting settings
        if (settings.preserveFormatting) {
            const parsed = this.parseFormattingMarkers(settings.text);
            this.textToType = this.cleanAndNormalizeText(parsed.cleanText);
            this.formattingMap = parsed.formattingMap;
            console.log('Flow: Formatting enabled, found', this.formattingMap.size, 'formatting markers');
        } else {
            this.textToType = this.cleanAndNormalizeText(settings.text);
            this.formattingMap = null;
        }
        
        this.originalText = settings.text; // Keep original for reference
        this.currentPosition = 0;
        this.isTyping = true;
        this.isPaused = false;

        // Find the editor
        this.editor = this.findGoogleDocsEditor();
        if (!this.editor) {
            this.sendMessage({
                action: 'typingError',
                error: 'Could not find Google Docs editor. Make sure you\'re on a Google Docs page.'
            });
            return;
        }

        // Ensure the editor gets focus - try multiple methods
        await this.ensureEditorFocus();

        // Flow is now typing

        // Small delay to ensure focus is established
        setTimeout(() => {
            this.typeNextCharacter();
        }, 100);
    }

    stopTyping() {
        this.isTyping = false;
        this.isPaused = false;
        if (this.typingTimeout) {
            clearTimeout(this.typingTimeout);
            this.typingTimeout = null;
        }
        this.sendMessage({ action: 'typingStopped' });
        
        // Flow has stopped
    }

    pauseTyping() {
        this.isPaused = true;
        if (this.typingTimeout) {
            clearTimeout(this.typingTimeout);
            this.typingTimeout = null;
        }
        // Flow is paused
    }

    resumeTyping() {
        this.isPaused = false;
        if (this.isTyping && this.currentPosition < this.textToType.length) {
            // Flow resumed
            this.typeNextCharacter();
        }
    }

    togglePause() {
        if (this.isPaused) {
            this.resumeTyping();
        } else {
            this.pauseTyping();
        }
    }

    async typeNextCharacter() {
        if (!this.isTyping || this.isPaused) {
            return;
        }

        if (this.currentPosition >= this.textToType.length) {
            this.completeTyping();
            return;
        }

        const char = this.textToType[this.currentPosition];
        
        // Handle formatting if enabled
        if (this.settings.preserveFormatting) {
            await this.handleFormatting(char);
        } else {
            await this.typeCharacter(char);
        }

        this.currentPosition++;
        
        // Update progress
        const percentage = (this.currentPosition / this.textToType.length) * 100;
        this.sendMessage({
            action: 'updateProgress',
            current: this.currentPosition,
            total: this.textToType.length,
            percentage: percentage
        });
        
        // Progress updated

        // Calculate delay for next character
        const delay = this.calculateDelay();
        
        // Skip typo simulation - no mistakes
        this.typingTimeout = setTimeout(() => this.typeNextCharacter(), delay);
    }

    async typeCharacter(char) {
        if (!this.editor) return;

        // Ensure editor still has focus before typing
        await this.ensureGoogleDocsFocus();

        const keyCode = char.charCodeAt(0);
        const isEnter = char === '\n';
        
        console.log(`Flow: Attempting to type character "${char}"`);
        
        // Always use single method to prevent duplicates
        const useSingleMethod = this.settings.singleMethod !== false;
        let methodsAttempted = [];
        let typingSucceeded = false;
        
        console.log(`Flow: Single method mode: ${useSingleMethod}`);
        
        // Method 1: execCommand (most reliable for Google Docs)
        if (!typingSucceeded) {
            try {
                let execSuccess = false;
                if (isEnter) {
                    execSuccess = document.execCommand('insertParagraph', false) || 
                                 document.execCommand('insertHTML', false, '<br>');
                } else {
                    execSuccess = document.execCommand('insertText', false, char);
                }
                methodsAttempted.push(`execCommand: ${execSuccess}`);
                
                if (execSuccess) {
                    console.log(`Flow: execCommand succeeded for "${char}"`);
                    typingSucceeded = true;
                    if (useSingleMethod) {
                        console.log(`Flow: Single method mode - stopping after successful execCommand`);
                        return; // Exit immediately in single method mode
                    }
                }
            } catch (e) {
                methodsAttempted.push(`execCommand: failed (${e.message})`);
                console.log('Flow: execCommand failed:', e);
            }
        }

        // Method 2: Clipboard paste (only if execCommand failed and clipboard is available)
        if (!typingSucceeded && !isEnter && char.length === 1) {
            try {
                // Check if clipboard write permission is available first
                if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                    await navigator.clipboard.writeText(char);
                    const pasteSuccess = document.execCommand('paste');
                    methodsAttempted.push(`clipboard: ${pasteSuccess}`);
                    if (pasteSuccess) {
                        console.log(`Flow: Clipboard paste succeeded for "${char}"`);
                        typingSucceeded = true;
                        if (useSingleMethod) {
                            console.log(`Flow: Single method mode - stopping after successful clipboard paste`);
                            return; // Exit immediately in single method mode
                        }
                    }
                } else {
                    methodsAttempted.push(`clipboard: not available`);
                }
            } catch (e) {
                methodsAttempted.push(`clipboard: failed (${e.message})`);
                console.log('Flow: Clipboard method failed:', e);
            }
        }

        // Method 3: Keyboard event simulation (only if previous methods failed or multi-method mode)
        if (!typingSucceeded || !useSingleMethod) {
            try {
                if (isEnter) {
                    this.simulateKeyPress('Enter', 13);
                } else {
                    this.simulateKeyPress(char, keyCode);
                }
                methodsAttempted.push('keyboardEvents: attempted');
                console.log(`Flow: Keyboard simulation attempted for "${char}"`);
                typingSucceeded = true;
                
                if (useSingleMethod) {
                    console.log(`Flow: Single method mode - stopping after keyboard simulation`);
                    return; // Exit immediately in single method mode
                }
            } catch (e) {
                methodsAttempted.push(`keyboardEvents: failed (${e.message})`);
                console.log('Flow: Keyboard simulation failed:', e);
            }
        }

        // Method 4: Input event simulation (only in multi-method mode as last resort)
        if (!useSingleMethod && !typingSucceeded) {
            try {
                const inputEvent = new InputEvent('input', {
                    inputType: 'insertText',
                    data: isEnter ? '\n' : char,
                    bubbles: true
                });

                const target = document.activeElement || this.editor || document;
                target.dispatchEvent(inputEvent);
                methodsAttempted.push('inputEvents: attempted');
                console.log(`Flow: Input event simulation attempted for "${char}"`);
            } catch (e) {
                methodsAttempted.push(`inputEvents: failed (${e.message})`);
                console.log('Flow: Input event simulation failed:', e);
            }
        }
        
        console.log(`Flow: Methods attempted for "${char}":`, methodsAttempted, `Single method: ${useSingleMethod}, Success: ${typingSucceeded}`);
    }

    async ensureGoogleDocsFocus() {
        // Try multiple methods to ensure Google Docs is focused and ready
        
        // 1. Focus the iframe
        if (this.editor && this.editor.focus) {
            this.editor.focus();
        }

        // 1b. If editor is an iframe, also focus its window and body specifically
        try {
            if (this.editor && this.editor.tagName === 'IFRAME') {
                const iframeWin = this.editor.contentWindow;
                const iframeDoc = this.editor.contentDocument || (iframeWin && iframeWin.document);
                if (iframeWin && iframeWin.focus) {
                    iframeWin.focus();
                }
                if (iframeDoc && iframeDoc.body && iframeDoc.body.focus) {
                    iframeDoc.body.focus();
                }
            }
        } catch (e) {
            console.log('Flow: Unable to focus iframe content');
        }

        // 2. Click on the canvas to ensure cursor is active
        const canvas = document.querySelector('.kix-canvas-tile-content');
        if (canvas) {
            const rect = canvas.getBoundingClientRect();
            const clickEvent = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                clientX: rect.left + rect.width / 2,
                clientY: rect.top + rect.height / 2
            });
            canvas.dispatchEvent(clickEvent);
        }

        // 3. Try to focus any contenteditable elements that might exist
        const editableElements = document.querySelectorAll('[contenteditable="true"]');
        editableElements.forEach(el => {
            if (el.offsetHeight > 0) {
                el.focus();
            }
        });

        // Small delay to let focus take effect
        await new Promise(resolve => setTimeout(resolve, 50));
    }

    simulateKeyPress(key, keyCode) {
        const target = this.editor;
        
        // Prepare keyboard event options
        const eventOptions = {
            key: key,
            code: key === 'Enter' ? 'Enter' : `Key${key.toUpperCase()}`,
            keyCode: keyCode,
            which: keyCode,
            charCode: key === 'Enter' ? 0 : keyCode,
            bubbles: true,
            cancelable: true,
            composed: true
        };

        // Create events
        const keydownEvent = new KeyboardEvent('keydown', eventOptions);
        const keypressEvent = new KeyboardEvent('keypress', eventOptions);
        const keyupEvent = new KeyboardEvent('keyup', eventOptions);

        // Choose a single, best-effort dispatch target to avoid duplicates
        let dispatchTarget = null;
        try {
            if (target && target.tagName === 'IFRAME') {
                const iframeWin = target.contentWindow;
                const iframeDoc = target.contentDocument || (iframeWin && iframeWin.document);
                if (iframeDoc && iframeDoc.body && iframeDoc.body.dispatchEvent) {
                    dispatchTarget = iframeDoc.body; // Prefer iframe body
                } else if (iframeWin && typeof iframeWin.dispatchEvent === 'function') {
                    dispatchTarget = iframeWin; // Fallback to iframe window
                }
            }
        } catch (e) {
            console.log('Flow: Cannot access iframe content for key dispatch');
        }

        if (!dispatchTarget) {
            dispatchTarget = document.activeElement || document; // Last resort
        }

        try {
            dispatchTarget.dispatchEvent(keydownEvent);
            dispatchTarget.dispatchEvent(keypressEvent);
            dispatchTarget.dispatchEvent(keyupEvent);
            console.log('Flow: Dispatched key events to single target');
        } catch (e) {
            console.log('Flow: Failed to dispatch key events:', e.message);
        }
    }

    async handleFormatting(char) {
        // Check if we need to apply formatting at current position
        if (this.formattingMap && this.formattingMap.has(this.currentPosition)) {
            const format = this.formattingMap.get(this.currentPosition);
            await this.applyFormatting(format);
        }
        
        // Type the character
        await this.typeCharacter(char);
    }

    async applyFormatting(format) {
        console.log(`Flow: Applying ${format.type} formatting (${format.action})`);
        
        try {
            // Use keyboard shortcuts to apply formatting in Google Docs
            const shortcuts = {
                bold: { key: 'b', keyCode: 66 },
                italic: { key: 'i', keyCode: 73 },
                underline: { key: 'u', keyCode: 85 }
            };
            
            const shortcut = shortcuts[format.type];
            if (shortcut) {
                // Simulate Ctrl+B, Ctrl+I, or Ctrl+U
                const keyEvent = new KeyboardEvent('keydown', {
                    key: shortcut.key,
                    code: `Key${shortcut.key.toUpperCase()}`,
                    keyCode: shortcut.keyCode,
                    ctrlKey: true,
                    bubbles: true,
                    cancelable: true
                });
                
                // Dispatch to multiple targets
                [this.editor, document.activeElement, document].forEach(target => {
                    if (target) target.dispatchEvent(keyEvent);
                });
                
                // Small delay to let formatting take effect
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        } catch (e) {
            console.log('Flow: Formatting application failed:', e);
        }
    }

    calculateDelay() {
        const baseDelay = 60000 / (this.settings.wpm * 5); // Convert WPM to milliseconds per character
        
        if (this.settings.naturalVariations) {
            // Add random variation (±30%)
            const variation = (Math.random() - 0.5) * 0.6;
            return Math.max(50, baseDelay * (1 + variation));
        }
        
        return Math.max(50, baseDelay);
    }

    completeTyping() {
        this.isTyping = false;
        this.isPaused = false;
        if (this.typingTimeout) {
            clearTimeout(this.typingTimeout);
            this.typingTimeout = null;
        }
        this.sendMessage({ action: 'typingComplete' });
        
        // Flow completed successfully
    }

    sendMessage(message) {
        try {
            chrome.runtime.sendMessage(message);
        } catch (err) {
            console.log('Failed to send message:', err);
        }
    }

    cleanAndNormalizeText(text) {
        if (!text) return '';
        
        console.log('Flow: Original text length:', text.length);
        
        // Step 1: Normalize Unicode characters
        let cleaned = text.normalize('NFD');
        
        // Step 2: Remove or replace problematic UTF characters
        cleaned = cleaned
            // Replace smart quotes with regular quotes
            .replace(/[\u2018\u2019]/g, "'")  // Smart single quotes
            .replace(/[\u201C\u201D]/g, '"')  // Smart double quotes
            
            // Replace em/en dashes with regular hyphens
            .replace(/[\u2013\u2014]/g, '-')  // Em dash, en dash
            
            // Replace ellipsis with three dots
            .replace(/\u2026/g, '...')
            
            // Replace non-breaking spaces with regular spaces
            .replace(/\u00A0/g, ' ')
            
            // Replace various whitespace characters with regular spaces
            .replace(/[\u2000-\u200B\u2028\u2029]/g, ' ')
            
            // Remove zero-width characters
            .replace(/[\u200B-\u200D\uFEFF]/g, '')
            
            // Remove combining diacritical marks if needed
            .replace(/[\u0300-\u036F]/g, '')
            
            // Replace curly apostrophe and quotes
            .replace(/[\u2032\u2033]/g, '"')
            
            // Convert various bullet points to regular asterisk
            .replace(/[\u2022\u2023\u25E6\u2043]/g, '*')
            
            // Replace copyright, trademark, etc. with text equivalents
            .replace(/\u00A9/g, '(c)')
            .replace(/\u00AE/g, '(R)')
            .replace(/\u2122/g, '(TM)')
            
            // Clean up multiple spaces
            .replace(/\s+/g, ' ')
            
            // Trim leading/trailing whitespace
            .trim();
        
        console.log('Flow: Cleaned text length:', cleaned.length);
        console.log('Flow: Character changes:', text.length - cleaned.length);
        
        return cleaned;
    }

    parseFormattingMarkers(text) {
        // Parse markdown-style formatting and create formatting map
        const formattingMap = new Map();
        let cleanText = text;
        let offset = 0;
        
        // Bold (**text** or __text__)
        cleanText = cleanText.replace(/(\*\*|__)(.*?)\1/g, (match, marker, content, index) => {
            const start = index - offset;
            const end = start + content.length;
            formattingMap.set(start, { type: 'bold', action: 'start' });
            formattingMap.set(end, { type: 'bold', action: 'end' });
            offset += marker.length * 2; // Account for removed markers
            return content;
        });
        
        // Italic (*text* or _text_)
        offset = 0;
        cleanText = cleanText.replace(/(\*|_)(.*?)\1/g, (match, marker, content, index) => {
            const start = index - offset;
            const end = start + content.length;
            formattingMap.set(start, { type: 'italic', action: 'start' });
            formattingMap.set(end, { type: 'italic', action: 'end' });
            offset += marker.length * 2;
            return content;
        });
        
        return { cleanText, formattingMap };
    }
}

// Initialize the typing engine when the page loads
let flowEngine = null;

// Wait for Google Docs to fully load
function initializeWhenReady() {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        // Add a small delay to ensure Google Docs is fully initialized
        setTimeout(() => {
            if (!flowEngine) {
                flowEngine = new FlowTypingEngine();
                console.log('Flow typing engine initialized');
            }
        }, 1000);
    } else {
        document.addEventListener('DOMContentLoaded', initializeWhenReady);
    }
}

// Initialize immediately if already loaded, otherwise wait
initializeWhenReady();

// Also listen for navigation changes in single-page apps like Google Docs
let lastUrl = location.href;
new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        // Reinitialize after navigation
        setTimeout(() => {
            if (!flowEngine || !flowEngine.findGoogleDocsEditor()) {
                flowEngine = new FlowTypingEngine();
            }
        }, 2000);
    }
}).observe(document, { subtree: true, childList: true });