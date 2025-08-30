class FlowTypingEngine {
    constructor() {
        this.isTyping = false;
        this.isPaused = false;
        this.currentPosition = 0;
        this.textToType = '';
        this.settings = {};
        this.typingTimeout = null;
        this.editor = null;
        this.overlay = null;
        this.setupMessageListener();
        this.createOverlay();
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
                case 'createMiniPlayer':
                    this.createMiniPlayer(message.settings);
                    sendResponse({ success: true });
                    break;
                case 'showOverlay':
                    this.showOverlay();
                    sendResponse({ success: true });
                    break;
                case 'hideOverlay':
                    this.hideOverlay();
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
        
        // Remove mini player when stopped
        if (this.miniPlayer) {
            this.removeMiniPlayer();
        }
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
        
        // Update mini player if it exists
        if (this.miniPlayer) {
            this.updateMiniPlayerProgress(this.currentPosition, this.textToType.length, percentage);
        }
        
        // Update overlay if it exists and is visible
        if (this.overlay && this.overlay.classList.contains('visible')) {
            this.updateOverlayProgress(this.currentPosition, this.textToType.length, percentage);
        }

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
                    // For line breaks, use insertParagraph to create proper paragraphs
                    execSuccess = document.execCommand('insertParagraph', false);
                    if (!execSuccess) {
                        // Fallback to insertHTML with proper paragraph structure
                        execSuccess = document.execCommand('insertHTML', false, '<p><br></p>');
                    }
                    if (!execSuccess) {
                        // Last resort: simple line break
                        execSuccess = document.execCommand('insertHTML', false, '<br>');
                    }
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
        
        // Remove mini player after completion
        if (this.miniPlayer) {
            setTimeout(() => {
                this.removeMiniPlayer();
            }, 2000); // Keep visible for 2 seconds to show completion
        }
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
        
        // Step 2: Preserve paragraph structure by normalizing line breaks
        cleaned = cleaned
            // Normalize different line break patterns to single \n
            .replace(/\r\n/g, '\n')  // Windows line breaks
            .replace(/\r/g, '\n')    // Mac line breaks
            
            // Preserve double line breaks as paragraph separators
            .replace(/\n\s*\n/g, '\n\n')  // Normalize paragraph breaks
        
        // Step 3: Remove or replace problematic UTF characters
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
            
            // Replace various whitespace characters with regular spaces (but preserve line breaks)
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
            
            // Clean up multiple spaces (but preserve single line breaks)
            .replace(/[ \t]+/g, ' ')  // Multiple spaces/tabs to single space
            .replace(/[ \t]*\n[ \t]*/g, '\n')  // Remove spaces around line breaks
            
            // Trim leading/trailing whitespace but preserve internal structure
            .replace(/^\s+|\s+$/g, '');
        
        console.log('Flow: Cleaned text length:', cleaned.length);
        console.log('Flow: Character changes:', text.length - cleaned.length);
        console.log('Flow: Paragraph breaks detected:', (cleaned.match(/\n\n/g) || []).length);
        
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
        
        // Reset offset for italic parsing
        offset = 0;
        
        // Italic (*text* or _text_) - but avoid conflict with bold
        cleanText = cleanText.replace(/(?<!\*)\*([^*]+)\*(?!\*)|(?<!_)_([^_]+)_(?!_)/g, (match, content1, content2, index) => {
            const content = content1 || content2;
            const start = index - offset;
            const end = start + content.length;
            formattingMap.set(start, { type: 'italic', action: 'start' });
            formattingMap.set(end, { type: 'italic', action: 'end' });
            offset += match.length - content.length; // Account for removed markers
            return content;
        });
        
        // Reset offset for underline parsing
        offset = 0;
        
        // Underline (~~text~~)
        cleanText = cleanText.replace(/~~(.*?)~~/g, (match, content, index) => {
            const start = index - offset;
            const end = start + content.length;
            formattingMap.set(start, { type: 'underline', action: 'start' });
            formattingMap.set(end, { type: 'underline', action: 'end' });
            offset += 4; // Account for removed ~~ markers
            return content;
        });
        
        return { cleanText, formattingMap };
    }

    createOverlay() {
        // Don't create if overlay already exists
        if (document.getElementById('flow-overlay')) return;

        // Inject Material Icons and Google Fonts
        this.injectOverlayDependencies();

        // Create overlay HTML with full popup interface
        const overlayHTML = `
            <div id="flow-overlay" class="flow-overlay">
                <div class="flow-overlay-content">
                    <div class="flow-overlay-header">
                        <h1>⚡ Flow</h1>
                        <p>Natural Typing Simulator</p>
                        <div class="flow-overlay-controls">
                            <button class="flow-overlay-minimize" id="flow-overlay-minimize">
                                <span class="material-icons">minimize</span>
                            </button>
                            <button class="flow-overlay-close" id="flow-overlay-close">
                                <span class="material-icons">close</span>
                            </button>
                        </div>
                    </div>
                    
                    <div class="flow-overlay-body">
                        <div class="flow-input-section">
                            <label for="flow-text-input">Text to Type:</label>
                            <textarea id="flow-text-input" placeholder="Paste your content here or click 'Paste from Clipboard'"></textarea>
                            <button id="flow-paste-btn" class="flow-secondary-btn">
                                <span class="material-icons">content_paste</span>
                                Paste from Clipboard
                            </button>
                        </div>

                        <div class="flow-controls-section">
                            <div class="flow-wpm-control">
                                <label for="flow-wpm-slider">Typing Speed: <span id="flow-wpm-value">60</span> WPM</label>
                                <input type="range" id="flow-wpm-slider" min="10" max="200" value="60" class="flow-slider">
                            </div>

                            <div class="flow-format-options">
                                <label class="flow-checkbox-container">
                                    <input type="checkbox" id="flow-preserve-formatting" checked>
                                    <span class="flow-checkmark"></span>
                                    Preserve formatting
                                    <svg class="flow-option-icon" viewBox="0 0 24 24" fill="#4ade80">
                                        <path d="M15.6,10.79C16.57,10.11 17.25,9.02 17.25,8C17.25,6.74 16.26,5.75 15,5.75C13.74,5.75 12.75,6.74 12.75,8C12.75,9.02 13.43,10.11 14.4,10.79C12.32,11.33 10.75,13.1 10.75,15.25C10.75,17.32 12.43,19 14.5,19C16.57,19 18.25,17.32 18.25,15.25C18.25,13.1 16.68,11.33 15.6,10.79Z"/>
                                    </svg>
                                </label>
                                <label class="flow-checkbox-container">
                                    <input type="checkbox" id="flow-natural-variations">
                                    <span class="flow-checkmark"></span>
                                    Natural typing variations
                                    <svg class="flow-option-icon" viewBox="0 0 24 24" fill="#4ade80">
                                        <path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4M11,17H13V11H11V17M11,9H13V7H11V9Z"/>
                                    </svg>
                                </label>
                                <label class="flow-checkbox-container">
                                    <input type="checkbox" id="flow-typo-simulation">
                                    <span class="flow-checkmark"></span>
                                    Simulate typos & corrections
                                    <svg class="flow-option-icon" viewBox="0 0 24 24" fill="#4ade80">
                                        <path d="M12,2C13.1,2 14,2.9 14,4C14,5.1 13.1,6 12,6C10.9,6 10,5.1 10,4C10,2.9 10.9,2 12,2M21,9V7L15,1H5C3.89,1 3,1.89 3,3V21A2,2 0 0,0 5,23H19A2,2 0 0,0 21,21V9M19,9H14V4H5V21H19V9Z"/>
                                    </svg>
                                </label>
                                <label class="flow-checkbox-container">
                                    <input type="checkbox" id="flow-run-in-background">
                                    <span class="flow-checkmark"></span>
                                    Run in background with mini player
                                    <svg class="flow-option-icon" viewBox="0 0 24 24" fill="#4ade80">
                                        <path d="M19,3H5A2,2 0 0,0 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5A2,2 0 0,0 19,3M19,19H5V5H19V19M8,15V9L13,12L8,15Z"/>
                                    </svg>
                                </label>
                            </div>
                        </div>

                        <div class="flow-action-section">
                            <button id="flow-start-btn" class="flow-primary-btn">
                                <span class="material-icons">play_arrow</span>
                                Start Flow
                            </button>
                            <button id="flow-stop-btn" class="flow-danger-btn" disabled>
                                <span class="material-icons">stop</span>
                                Stop
                            </button>
                            <button id="flow-pause-btn" class="flow-secondary-btn flow-pause-btn" disabled>
                                <span class="material-icons">pause</span>
                                Pause
                            </button>
                        </div>

                        <div class="flow-status-section">
                            <div id="flow-status" class="flow-status-idle">Ready to start</div>
                            <div id="flow-progress-container" class="flow-hidden">
                                <div class="flow-progress-bar">
                                    <div id="flow-progress-fill"></div>
                                </div>
                                <div id="flow-progress-text">0% complete</div>
                            </div>
                        </div>
                    </div>

                    <div class="flow-overlay-footer">
                        <div class="flow-tips">
                            💡 Click in Google Docs editor first, then start Flow. The extension will automatically focus the editor and begin typing.
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Insert overlay into page
        const overlayDiv = document.createElement('div');
        overlayDiv.innerHTML = overlayHTML;
        document.body.appendChild(overlayDiv.firstElementChild);

        this.overlay = document.getElementById('flow-overlay');
        this.setupOverlayEvents();
        this.loadOverlaySettings();
    }

    injectOverlayDependencies() {
        // Inject Material Icons if not already present
        if (!document.querySelector('link[href*="fonts.googleapis.com/icon"]')) {
            const materialIconsLink = document.createElement('link');
            materialIconsLink.rel = 'stylesheet';
            materialIconsLink.href = 'https://fonts.googleapis.com/icon?family=Material+Icons';
            document.head.appendChild(materialIconsLink);
        }

        // Inject Google Fonts if not already present
        if (!document.querySelector('link[href*="fonts.googleapis.com/css2?family=Nunito"]')) {
            const googleFontsLink = document.createElement('link');
            googleFontsLink.rel = 'stylesheet';
            googleFontsLink.href = 'https://fonts.googleapis.com/css2?family=Nunito:wght@300;400;500;600;700&display=swap';
            document.head.appendChild(googleFontsLink);
        }

        // Inject overlay CSS
        this.injectOverlayCSS();
    }

    injectOverlayCSS() {
        // Check if CSS already exists
        if (document.getElementById('flow-overlay-styles')) return;

        const css = `
            .flow-overlay {
                position: fixed;
                top: 20px;
                right: 20px;
                width: 420px;
                max-height: calc(100vh - 40px);
                z-index: 999999;
                display: none;
                font-family: 'Nunito', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background: white;
                border-radius: 20px;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                overflow: hidden;
                border: 1px solid rgba(0, 0, 0, 0.1);
                backdrop-filter: blur(20px);
                transform: translateX(100%);
                opacity: 0;
                transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            }

            .flow-overlay.visible {
                display: block;
                transform: translateX(0);
                opacity: 1;
            }

            .flow-overlay.dragging {
                transition: none;
                cursor: move;
                user-select: none;
            }

            .flow-overlay-content {
                position: relative;
                width: 100%;
                height: 100%;
                display: flex;
                flex-direction: column;
            }

            @keyframes slideUp {
                from {
                    opacity: 0;
                    transform: translateY(30px) scale(0.95);
                }
                to {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                }
            }

            .flow-overlay-header {
                background: linear-gradient(135deg, #4ade80 0%, #22c55e 100%);
                color: white;
                padding: 20px 24px;
                text-align: center;
                position: relative;
                overflow: hidden;
                cursor: move;
                user-select: none;
                flex-shrink: 0;
            }

            .flow-overlay-header::before {
                content: '';
                position: absolute;
                top: -50%;
                left: -50%;
                width: 200%;
                height: 200%;
                background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%);
                animation: float 6s ease-in-out infinite;
            }

            .flow-overlay-header h1 {
                font-size: 24px;
                font-weight: 700;
                margin-bottom: 4px;
                position: relative;
                z-index: 1;
            }

            .flow-overlay-header p {
                font-size: 14px;
                opacity: 0.95;
                font-weight: 400;
                position: relative;
                z-index: 1;
            }

            .flow-overlay-controls {
                position: absolute;
                top: 16px;
                right: 16px;
                display: flex;
                gap: 8px;
                z-index: 2;
            }

            .flow-overlay-minimize,
            .flow-overlay-close {
                background: rgba(255, 255, 255, 0.2);
                border: none;
                color: white;
                width: 32px;
                height: 32px;
                border-radius: 8px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s ease;
            }

            .flow-overlay-minimize:hover,
            .flow-overlay-close:hover {
                background: rgba(255, 255, 255, 0.3);
                transform: scale(1.05);
            }

            .flow-overlay.minimized {
                width: 60px;
                height: 60px;
                border-radius: 50%;
                overflow: hidden;
                cursor: pointer;
            }

            .flow-overlay.minimized .flow-overlay-content {
                display: none;
            }

            .flow-overlay.minimized::before {
                content: '⚡';
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                font-size: 24px;
                color: #4ade80;
                z-index: 1;
            }

            .flow-overlay-body {
                padding: 24px;
                display: grid;
                grid-template-columns: 1fr;
                gap: 20px;
                background: linear-gradient(135deg, rgba(254, 243, 199, 0.3) 0%, rgba(254, 243, 199, 0.1) 100%);
                flex: 1;
                overflow-y: auto;
                grid-auto-rows: min-content;
            }

            .flow-input-section {
                display: flex;
                flex-direction: column;
                gap: 12px;
                background: linear-gradient(135deg, rgba(237, 233, 254, 1) 0%, rgba(237, 233, 254, 0.8) 100%);
                padding: 20px;
                border-radius: 16px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
                border: 1px solid rgba(237, 233, 254, 0.5);
            }

            .flow-input-section label {
                font-weight: 600;
                font-size: 16px;
                color: #3c4043;
                display: flex;
                align-items: center;
                gap: 10px;
            }

            .flow-input-section label::before {
                content: '';
                width: 22px;
                height: 22px;
                background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%234ade80"><path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z" /></svg>') no-repeat center;
                background-size: contain;
                flex-shrink: 0;
            }

            #flow-text-input {
                width: 100%;
                height: 100px;
                padding: 16px;
                border: 2px solid #e8eaed;
                border-radius: 12px;
                font-size: 14px;
                font-family: 'Nunito', sans-serif;
                font-weight: 400;
                resize: vertical;
                transition: all 0.3s ease;
                background: #fafbfc;
                line-height: 1.5;
            }

            #flow-text-input:focus {
                outline: none;
                border-color: #4ade80;
                box-shadow: 0 0 0 4px rgba(74, 222, 128, 0.12);
                background: white;
            }

            .flow-secondary-btn {
                align-self: flex-start;
                background: white;
                border: 2px solid #e8eaed;
                color: #5f6368;
                padding: 14px 24px;
                border-radius: 12px;
                font-size: 14px;
                font-weight: 500;
                font-family: 'Nunito', sans-serif;
                cursor: pointer;
                transition: all 0.3s ease;
                display: flex;
                align-items: center;
                gap: 10px;
                box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
            }

            .flow-secondary-btn:hover {
                background: #f8f9fa;
                border-color: #4ade80;
                transform: translateY(-1px);
                box-shadow: 0 6px 16px rgba(74, 222, 128, 0.15);
            }

            .flow-controls-section {
                background: linear-gradient(135deg, rgba(224, 242, 254, 1) 0%, rgba(224, 242, 254, 0.8) 100%);
                padding: 20px;
                border-radius: 16px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
                border: 1px solid rgba(224, 242, 254, 0.5);
                display: grid;
                grid-template-columns: 1fr;
                gap: 18px;
            }

            .flow-wpm-control {
                display: flex;
                flex-direction: column;
                gap: 16px;
            }

            .flow-wpm-control label {
                font-weight: 600;
                font-size: 16px;
                color: #3c4043;
                display: flex;
                align-items: center;
                gap: 10px;
            }

            .flow-wmp-control label::before {
                content: '';
                width: 22px;
                height: 22px;
                background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%234ade80"><path d="M12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,6A6,6 0 0,0 6,12A6,6 0 0,0 12,18A6,6 0 0,0 18,12A6,6 0 0,0 12,6M12,8A4,4 0 0,1 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12A4,4 0 0,1 12,8M12,10A2,2 0 0,0 10,12A2,2 0 0,0 12,14A2,2 0 0,0 14,12A2,2 0 0,0 12,10Z" /></svg>') no-repeat center;
                background-size: contain;
                flex-shrink: 0;
            }

            .flow-slider {
                width: 100%;
                height: 10px;
                border-radius: 6px;
                background: linear-gradient(to right, #e8eaed 0%, #e8eaed 100%);
                outline: none;
                -webkit-appearance: none;
                appearance: none;
                cursor: pointer;
                position: relative;
            }

            .flow-slider::-webkit-slider-thumb {
                -webkit-appearance: none;
                appearance: none;
                width: 26px;
                height: 26px;
                border-radius: 50%;
                background: linear-gradient(135deg, #4ade80 0%, #22c55e 100%);
                cursor: pointer;
                box-shadow: 0 4px 12px rgba(74, 222, 128, 0.3);
                border: 3px solid white;
                transition: all 0.2s ease;
            }

            .flow-slider::-webkit-slider-thumb:hover {
                transform: scale(1.1);
                box-shadow: 0 6px 16px rgba(74, 222, 128, 0.4);
            }

            .flow-format-options {
                display: grid;
                grid-template-columns: 1fr;
                gap: 12px;
            }

            .flow-checkbox-container {
                display: flex;
                align-items: center;
                font-size: 14px;
                color: #3c4043;
                cursor: pointer;
                user-select: none;
                padding: 12px;
                border-radius: 12px;
                transition: all 0.2s ease;
                position: relative;
                font-weight: 500;
            }

            .flow-checkbox-container:hover {
                background: rgba(255, 255, 255, 0.7);
            }

            .flow-checkbox-container input {
                position: absolute;
                opacity: 0;
                cursor: pointer;
                width: 0;
                height: 0;
            }

            .flow-checkmark {
                width: 22px;
                height: 22px;
                border: 2px solid #e8eaed;
                border-radius: 6px;
                margin-right: 14px;
                position: relative;
                transition: all 0.3s ease;
                background: white;
                flex-shrink: 0;
            }

            .flow-checkbox-container input:checked ~ .flow-checkmark {
                background: linear-gradient(135deg, #4ade80 0%, #22c55e 100%);
                border-color: #4ade80;
                transform: scale(1.05);
            }

            .flow-checkmark:after {
                content: '';
                position: absolute;
                display: none;
                left: 7px;
                top: 3px;
                width: 6px;
                height: 10px;
                border: solid white;
                border-width: 0 2px 2px 0;
                transform: rotate(45deg);
            }

            .flow-checkbox-container input:checked ~ .flow-checkmark:after {
                display: block;
            }

            .flow-option-icon {
                width: 20px;
                height: 20px;
                margin-left: auto;
                opacity: 0.7;
                transition: opacity 0.2s ease;
            }

            .flow-checkbox-container:hover .flow-option-icon {
                opacity: 1;
            }

            .flow-action-section {
                display: grid;
                grid-template-columns: 2fr 1fr 1fr;
                gap: 12px;
                background: linear-gradient(135deg, rgba(254, 243, 199, 1) 0%, rgba(254, 243, 199, 0.8) 100%);
                padding: 20px;
                border-radius: 16px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
                border: 1px solid rgba(254, 243, 199, 0.5);
            }

            .flow-primary-btn {
                background: linear-gradient(135deg, #4ade80 0%, #22c55e 100%);
                color: white;
                border: none;
                padding: 16px 20px;
                border-radius: 12px;
                font-size: 15px;
                font-weight: 600;
                font-family: 'Nunito', sans-serif;
                cursor: pointer;
                transition: all 0.3s ease;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                box-shadow: 0 4px 12px rgba(74, 222, 128, 0.25);
                grid-column: 1;
            }

            .flow-primary-btn:hover:not(:disabled) {
                transform: translateY(-2px);
                box-shadow: 0 8px 20px rgba(74, 222, 128, 0.35);
            }

            .flow-primary-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
                transform: none;
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            }

            .flow-danger-btn {
                background: linear-gradient(135deg, #dc3545 0%, #c82333 100%);
                color: white;
                border: none;
                padding: 14px 16px;
                border-radius: 12px;
                font-size: 14px;
                font-weight: 600;
                font-family: 'Nunito', sans-serif;
                cursor: pointer;
                transition: all 0.3s ease;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                box-shadow: 0 4px 12px rgba(220, 53, 69, 0.25);
                grid-column: 2;
            }

            .flow-secondary-btn.flow-pause-btn {
                padding: 14px 16px;
                font-size: 14px;
                gap: 6px;
                grid-column: 3;
            }

            .flow-danger-btn:hover:not(:disabled) {
                transform: translateY(-2px);
                box-shadow: 0 8px 20px rgba(220, 53, 69, 0.35);
            }

            .flow-danger-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
                transform: none;
            }

            .flow-secondary-btn .material-icons,
            .flow-primary-btn .material-icons,
            .flow-danger-btn .material-icons {
                font-size: 20px;
            }

            .flow-status-section {
                display: flex;
                flex-direction: column;
                gap: 16px;
                background: linear-gradient(135deg, rgba(224, 242, 254, 1) 0%, rgba(224, 242, 254, 0.8) 100%);
                padding: 24px;
                border-radius: 16px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
                border: 1px solid rgba(224, 242, 254, 0.5);
            }

            #flow-status {
                font-size: 15px;
                font-weight: 600;
                padding: 16px 20px;
                border-radius: 12px;
                text-align: center;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                transition: all 0.3s ease;
            }

            #flow-status::before {
                content: '';
                width: 18px;
                height: 18px;
                border-radius: 50%;
                flex-shrink: 0;
            }

            .flow-status-idle {
                background: #e8f0fe;
                color: #1a73e8;
                border: 1px solid #d2e3fc;
            }

            .flow-status-idle::before {
                background: #1a73e8;
            }

            .flow-status-running {
                background: #e6f4ea;
                color: #137333;
                border: 1px solid #ceead6;
                animation: pulse 2s infinite;
            }

            .flow-status-running::before {
                background: #137333;
                animation: pulse 2s infinite;
            }

            .flow-status-error {
                background: #fce8e6;
                color: #d93025;
                border: 1px solid #f9dedc;
            }

            .flow-status-error::before {
                background: #d93025;
            }

            .flow-progress-bar {
                width: 100%;
                height: 10px;
                background: #f1f3f4;
                border-radius: 6px;
                overflow: hidden;
                box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.1);
            }

            #flow-progress-fill {
                height: 100%;
                background: linear-gradient(135deg, #4ade80 0%, #22c55e 100%);
                width: 0%;
                transition: width 0.4s ease;
                position: relative;
            }

            #flow-progress-fill::after {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent);
                animation: shimmer 2s infinite;
            }

            #flow-progress-text {
                font-size: 14px;
                color: #5f6368;
                text-align: center;
                font-weight: 500;
                margin-top: 8px;
            }

            .flow-hidden {
                display: none !important;
            }

            .flow-overlay-footer {
                background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
                padding: 20px 24px;
                border-top: 1px solid #e8eaed;
            }

            .flow-tips {
                font-size: 14px;
                color: #5f6368;
                text-align: center;
                font-weight: 500;
                line-height: 1.5;
            }

            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.7; }
            }

            @keyframes float {
                0%, 100% { transform: translateY(0px) rotate(0deg); }
                33% { transform: translateY(-10px) rotate(1deg); }
                66% { transform: translateY(5px) rotate(-1deg); }
            }

            @keyframes shimmer {
                0% { transform: translateX(-100%); }
                100% { transform: translateX(200%); }
            }

            /* Responsive Design */
            @media (max-width: 1200px) {
                .flow-overlay {
                    width: 380px;
                    right: 15px;
                    top: 15px;
                }
            }

            @media (max-width: 768px) {
                .flow-overlay {
                    width: calc(100vw - 20px);
                    max-width: 400px;
                    right: 10px;
                    top: 10px;
                    left: 10px;
                    transform: translateY(-100%);
                }

                .flow-overlay.visible {
                    transform: translateY(0);
                }

                .flow-overlay-body {
                    padding: 20px;
                    gap: 16px;
                }

                .flow-action-section {
                    grid-template-columns: 1fr;
                    gap: 10px;
                }

                .flow-primary-btn,
                .flow-danger-btn,
                .flow-secondary-btn.flow-pause-btn {
                    grid-column: 1;
                    padding: 14px 18px;
                }

                .flow-format-options {
                    gap: 8px;
                }

                .flow-checkbox-container {
                    padding: 10px;
                    font-size: 13px;
                }

                #flow-text-input {
                    height: 80px;
                    padding: 14px;
                }
            }

            @media (max-width: 480px) {
                .flow-overlay {
                    width: calc(100vw - 16px);
                    right: 8px;
                    top: 8px;
                    left: 8px;
                }

                .flow-overlay-header {
                    padding: 16px 20px;
                }

                .flow-overlay-header h1 {
                    font-size: 20px;
                }

                .flow-overlay-body {
                    padding: 16px;
                    gap: 14px;
                }

                .flow-input-section,
                .flow-controls-section,
                .flow-action-section,
                .flow-status-section {
                    padding: 16px;
                }

                .flow-checkbox-container {
                    padding: 8px;
                    font-size: 12px;
                }

                .flow-checkmark {
                    width: 18px;
                    height: 18px;
                    margin-right: 10px;
                }

                .flow-option-icon {
                    width: 16px;
                    height: 16px;
                }
            }

            /* Grid Layout Improvements */
            @media (min-width: 500px) {
                .flow-format-options {
                    grid-template-columns: 1fr 1fr;
                    gap: 10px 16px;
                }
            }

            @media (min-width: 600px) {
                .flow-overlay {
                    width: 480px;
                }

                .flow-overlay-body {
                    padding: 28px;
                }

                .flow-controls-section {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 20px;
                    align-items: start;
                }

                .flow-wmp-control {
                    grid-column: 1;
                }

                .flow-format-options {
                    grid-column: 2;
                    grid-template-columns: 1fr;
                }
            }
        `;

        const style = document.createElement('style');
        style.id = 'flow-overlay-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }

    showOverlay() {
        if (this.overlay) {
            this.overlay.classList.add('visible');
        }
    }

    hideOverlay() {
        if (this.overlay) {
            this.overlay.classList.remove('visible');
        }
    }

    setupOverlayEvents() {
        if (!this.overlay) return;

        // Get overlay elements
        const elements = {
            closeBtn: this.overlay.querySelector('#flow-overlay-close'),
            minimizeBtn: this.overlay.querySelector('#flow-overlay-minimize'),
            textInput: this.overlay.querySelector('#flow-text-input'),
            pasteBtn: this.overlay.querySelector('#flow-paste-btn'),
            wmpSlider: this.overlay.querySelector('#flow-wpm-slider'),
            wmpValue: this.overlay.querySelector('#flow-wpm-value'),
            preserveFormatting: this.overlay.querySelector('#flow-preserve-formatting'),
            naturalVariations: this.overlay.querySelector('#flow-natural-variations'),
            typoSimulation: this.overlay.querySelector('#flow-typo-simulation'),
            runInBackground: this.overlay.querySelector('#flow-run-in-background'),
            startBtn: this.overlay.querySelector('#flow-start-btn'),
            pauseBtn: this.overlay.querySelector('#flow-pause-btn'),
            stopBtn: this.overlay.querySelector('#flow-stop-btn'),
            status: this.overlay.querySelector('#flow-status'),
            progressContainer: this.overlay.querySelector('#flow-progress-container'),
            progressFill: this.overlay.querySelector('#flow-progress-fill'),
            progressText: this.overlay.querySelector('#flow-progress-text')
        };

        // Close overlay
        elements.closeBtn.addEventListener('click', () => {
            this.hideOverlay();
        });

        // Minimize/maximize overlay
        elements.minimizeBtn.addEventListener('click', () => {
            this.overlay.classList.toggle('minimized');
        });

        // Click on minimized overlay to maximize
        this.overlay.addEventListener('click', (e) => {
            if (this.overlay.classList.contains('minimized') && !e.target.closest('button')) {
                this.overlay.classList.remove('minimized');
            }
        });

        // Paste from clipboard
        elements.pasteBtn.addEventListener('click', async () => {
            try {
                const text = await navigator.clipboard.readText();
                elements.textInput.value = text;
                this.updateOverlayStatus('Text pasted! Now click in Google Docs where you want to start typing.', 'idle');
            } catch (err) {
                this.updateOverlayStatus('Failed to read clipboard', 'error');
            }
        });

        // WPM slider
        elements.wmpSlider.addEventListener('input', (e) => {
            elements.wmpValue.textContent = e.target.value;
            this.saveOverlaySettings();
        });

        // Start button
        elements.startBtn.addEventListener('click', () => {
            this.startTypingFromOverlay();
        });

        // Pause button
        elements.pauseBtn.addEventListener('click', () => {
            this.togglePause();
            this.updateOverlayUI();
        });

        // Stop button
        elements.stopBtn.addEventListener('click', () => {
            this.stopTyping();
        });

        // Settings changes
        [elements.preserveFormatting, elements.naturalVariations, elements.typoSimulation, elements.runInBackground]
            .forEach(el => el.addEventListener('change', () => this.saveOverlaySettings()));

        this.overlayElements = elements;
        
        // Setup dragging functionality
        this.setupOverlayDragging();
    }

    setupOverlayDragging() {
        if (!this.overlay) return;
        
        const header = this.overlay.querySelector('.flow-overlay-header');
        let isDragging = false;
        let startX, startY, startLeft, startTop;

        header.addEventListener('mousedown', (e) => {
            // Don't drag when clicking buttons
            if (e.target.closest('button')) return;
            
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            
            const rect = this.overlay.getBoundingClientRect();
            startLeft = rect.left;
            startTop = rect.top;
            
            this.overlay.classList.add('dragging');
            
            const handleMouseMove = (e) => {
                if (!isDragging) return;
                
                const deltaX = e.clientX - startX;
                const deltaY = e.clientY - startY;
                
                const newLeft = Math.max(0, Math.min(window.innerWidth - this.overlay.offsetWidth, startLeft + deltaX));
                const newTop = Math.max(0, Math.min(window.innerHeight - this.overlay.offsetHeight, startTop + deltaY));
                
                this.overlay.style.left = newLeft + 'px';
                this.overlay.style.top = newTop + 'px';
                this.overlay.style.right = 'auto';
            };

            const handleMouseUp = () => {
                isDragging = false;
                this.overlay.classList.remove('dragging');
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
            };

            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        });
    }

    startTypingFromOverlay() {
        if (!this.overlayElements) return;
        
        const text = this.overlayElements.textInput.value.trim();
        if (!text) {
            this.updateOverlayStatus('Please enter some text to type', 'error');
            return;
        }

        const settings = {
            text: text,
            wpm: parseInt(this.overlayElements.wmpSlider.value),
            preserveFormatting: this.overlayElements.preserveFormatting.checked,
            naturalVariations: this.overlayElements.naturalVariations.checked,
            typoSimulation: this.overlayElements.typoSimulation.checked,
            runInBackground: this.overlayElements.runInBackground.checked,
            singleMethod: true
        };

        // If run in background is enabled, create mini player and hide overlay
        if (settings.runInBackground) {
            this.createMiniPlayer(settings);
            this.hideOverlay();
        }

        this.startTyping(settings);
    }

    updateOverlayStatus(message, type) {
        if (!this.overlayElements) return;
        
        this.overlayElements.status.textContent = message;
        this.overlayElements.status.className = `flow-status-${type}`;
    }

    updateOverlayProgress(current, total, percentage) {
        if (!this.overlayElements) return;
        
        this.overlayElements.progressContainer.classList.remove('flow-hidden');
        this.overlayElements.progressFill.style.width = `${percentage}%`;
        this.overlayElements.progressText.textContent = `${Math.round(percentage)}% complete (${current}/${total} characters)`;
    }

    updateOverlayUI() {
        if (!this.overlayElements) return;
        
        this.overlayElements.startBtn.disabled = this.isTyping;
        this.overlayElements.pauseBtn.disabled = !this.isTyping;
        this.overlayElements.stopBtn.disabled = !this.isTyping;
        
        // Update pause button
        const pauseIcon = this.overlayElements.pauseBtn.querySelector('.material-icons');
        const pauseText = this.overlayElements.pauseBtn.childNodes[2];
        
        if (this.isPaused) {
            pauseIcon.textContent = 'play_arrow';
            pauseText.textContent = 'Resume';
        } else {
            pauseIcon.textContent = 'pause';
            pauseText.textContent = 'Pause';
        }
        
        this.overlayElements.textInput.disabled = this.isTyping;
    }

    saveOverlaySettings() {
        if (!this.overlayElements) return;
        
        const settings = {
            wpm: parseInt(this.overlayElements.wmpSlider.value),
            preserveFormatting: this.overlayElements.preserveFormatting.checked,
            naturalVariations: this.overlayElements.naturalVariations.checked,
            typoSimulation: this.overlayElements.typoSimulation.checked,
            runInBackground: this.overlayElements.runInBackground.checked,
            singleMethod: true
        };
        
        chrome.storage.sync.set({ flowSettings: settings });
    }

    async loadOverlaySettings() {
        if (!this.overlayElements) return;
        
        try {
            const result = await chrome.storage.sync.get(['flowSettings']);
            if (result.flowSettings) {
                const settings = result.flowSettings;
                this.overlayElements.wmpSlider.value = settings.wpm || 60;
                this.overlayElements.wmpValue.textContent = settings.wpm || 60;
                this.overlayElements.preserveFormatting.checked = settings.preserveFormatting !== false;
                this.overlayElements.naturalVariations.checked = settings.naturalVariations || false;
                this.overlayElements.typoSimulation.checked = settings.typoSimulation || false;
                this.overlayElements.runInBackground.checked = settings.runInBackground || false;
            }
        } catch (err) {
            console.log('Failed to load overlay settings:', err);
        }
    }

    createMiniPlayer(settings) {
        // Remove any existing mini player
        const existingPlayer = document.getElementById('flow-mini-player');
        if (existingPlayer) {
            existingPlayer.remove();
        }

        // Create mini player HTML
        const playerHTML = `
            <div id="flow-mini-player" class="flow-mini-player">
                <div class="flow-mini-player-header">
                    <div class="flow-mini-player-title">Flow Typing</div>
                    <div class="flow-mini-player-controls">
                        <button class="flow-mini-btn" id="flow-mini-pause">
                            <span class="material-icons">pause</span>
                        </button>
                        <button class="flow-mini-btn" id="flow-mini-stop">
                            <span class="material-icons">stop</span>
                        </button>
                        <button class="flow-mini-btn" id="flow-mini-close">
                            <span class="material-icons">close</span>
                        </button>
                    </div>
                </div>
                <div class="flow-mini-progress-container">
                    <div class="flow-mini-progress-bar">
                        <div class="flow-mini-progress-fill" id="flow-mini-progress-fill"></div>
                    </div>
                </div>
                <div class="flow-mini-info">
                    <div class="flow-mini-text" id="flow-mini-text">${settings.text.substring(0, 30)}...</div>
                    <div class="flow-mini-stats" id="flow-mini-stats">0%</div>
                </div>
            </div>
        `;

        // Inject CSS for mini player
        this.injectMiniPlayerCSS();

        // Insert mini player into page
        const playerDiv = document.createElement('div');
        playerDiv.innerHTML = playerHTML;
        document.body.appendChild(playerDiv.firstElementChild);

        // Setup mini player events
        this.setupMiniPlayerEvents();

        // Show mini player with animation
        setTimeout(() => {
            const miniPlayer = document.getElementById('flow-mini-player');
            if (miniPlayer) {
                miniPlayer.classList.add('visible');
            }
        }, 100);

        this.miniPlayer = document.getElementById('flow-mini-player');
    }

    injectMiniPlayerCSS() {
        // Check if CSS already exists
        if (document.getElementById('flow-mini-player-styles')) return;

        // Inject Material Icons if not already present
        if (!document.querySelector('link[href*="fonts.googleapis.com/icon"]')) {
            const materialIconsLink = document.createElement('link');
            materialIconsLink.rel = 'stylesheet';
            materialIconsLink.href = 'https://fonts.googleapis.com/icon?family=Material+Icons';
            document.head.appendChild(materialIconsLink);
        }

        const css = `
            .flow-mini-player {
                position: fixed;
                bottom: 20px;
                right: 20px;
                width: 320px;
                background: rgba(0, 0, 0, 0.9);
                backdrop-filter: blur(20px);
                border-radius: 16px;
                padding: 16px 20px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
                border: 1px solid rgba(255, 255, 255, 0.1);
                z-index: 10000;
                transform: translateY(100px);
                opacity: 0;
                transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
                font-family: 'Nunito', -apple-system, BlinkMacSystemFont, sans-serif;
            }

            .flow-mini-player.visible {
                transform: translateY(0);
                opacity: 1;
            }

            .flow-mini-player-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 12px;
            }

            .flow-mini-player-title {
                color: white;
                font-size: 14px;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .flow-mini-player-title::before {
                content: '⚡';
                font-size: 16px;
                filter: drop-shadow(0 0 4px rgba(74, 222, 128, 0.6));
            }

            .flow-mini-player-controls {
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .flow-mini-btn {
                background: rgba(255, 255, 255, 0.1);
                border: none;
                color: white;
                width: 32px;
                height: 32px;
                border-radius: 8px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s ease;
                font-size: 14px;
            }

            .flow-mini-btn .material-icons {
                font-size: 16px;
            }

            .flow-mini-btn:hover {
                background: rgba(255, 255, 255, 0.2);
                transform: scale(1.05);
            }

            .flow-mini-progress-container {
                margin-bottom: 8px;
            }

            .flow-mini-progress-bar {
                width: 100%;
                height: 6px;
                background: rgba(255, 255, 255, 0.2);
                border-radius: 3px;
                overflow: hidden;
                cursor: pointer;
                position: relative;
            }

            .flow-mini-progress-fill {
                height: 100%;
                background: linear-gradient(135deg, #4ade80 0%, #22c55e 100%);
                width: 0%;
                transition: width 0.3s ease;
                position: relative;
            }

            .flow-mini-progress-fill::after {
                content: '';
                position: absolute;
                top: 0;
                right: 0;
                width: 8px;
                height: 100%;
                background: rgba(255, 255, 255, 0.8);
                border-radius: 0 3px 3px 0;
                box-shadow: 0 0 6px rgba(74, 222, 128, 0.6);
            }

            .flow-mini-info {
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 12px;
                color: rgba(255, 255, 255, 0.8);
            }

            .flow-mini-text {
                flex: 1;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                margin-right: 12px;
            }

            .flow-mini-stats {
                font-weight: 500;
                color: #4ade80;
            }
        `;

        const style = document.createElement('style');
        style.id = 'flow-mini-player-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }

    setupMiniPlayerEvents() {
        const pauseBtn = document.getElementById('flow-mini-pause');
        const stopBtn = document.getElementById('flow-mini-stop');
        const closeBtn = document.getElementById('flow-mini-close');

        if (pauseBtn) {
            pauseBtn.addEventListener('click', () => {
                this.togglePause();
                const icon = pauseBtn.querySelector('.material-icons');
                if (icon) {
                    icon.textContent = this.isPaused ? 'play_arrow' : 'pause';
                }
            });
        }

        if (stopBtn) {
            stopBtn.addEventListener('click', () => {
                this.stopTyping();
                this.removeMiniPlayer();
            });
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.removeMiniPlayer();
            });
        }
    }

    updateMiniPlayerProgress(current, total, percentage) {
        const progressFill = document.getElementById('flow-mini-progress-fill');
        const statsElement = document.getElementById('flow-mini-stats');
        
        if (progressFill) {
            progressFill.style.width = `${percentage}%`;
        }
        
        if (statsElement) {
            statsElement.textContent = `${Math.round(percentage)}%`;
        }
    }

    removeMiniPlayer() {
        const miniPlayer = document.getElementById('flow-mini-player');
        if (miniPlayer) {
            miniPlayer.classList.remove('visible');
            setTimeout(() => {
                miniPlayer.remove();
            }, 400);
        }
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