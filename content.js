class FlowTypingEngine {
    constructor() {
        this.isTyping = false;
        this.isPaused = false;
        this.currentPosition = 0;
        this.textToType = '';
        this.settings = {};
        this.typingTimeout = null;
        this.editor = null;
        this.floatingWidget = null;
        this.editorClickDetected = false;
        this.dragState = { isDragging: false, startX: 0, startY: 0, startLeft: 0, startTop: 0 };
        this.setupMessageListener();
        this.injectFloatingWidget();
        this.setupEditorClickDetection();
    }

    setupMessageListener() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            switch (message.action) {
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

        // Update widget UI
        this.updateWidgetStatus('Flow is typing...', 'running');
        this.updateStepsForTyping();
        this.updateWidgetUI();

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
        
        // Update widget UI
        this.updateWidgetStatus('Flow stopped', 'ready');
        this.updateStepProgress(); // Reset to appropriate step
        this.updateWidgetUI();
        if (this.widgetElements) {
            this.widgetElements.progress.classList.remove('visible');
        }
    }

    pauseTyping() {
        this.isPaused = true;
        if (this.typingTimeout) {
            clearTimeout(this.typingTimeout);
            this.typingTimeout = null;
        }
        this.updateWidgetStatus('Flow paused', 'ready');
        this.updateWidgetUI();
    }

    resumeTyping() {
        this.isPaused = false;
        if (this.isTyping && this.currentPosition < this.textToType.length) {
            this.updateWidgetStatus('Flow resumed', 'running');
            this.updateWidgetUI();
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
        
        // Update floating widget progress
        this.updateWidgetProgress(this.currentPosition, this.textToType.length, percentage);

        // Calculate delay for next character
        const delay = this.calculateDelay();
        
        // Add typo simulation if enabled
        if (this.settings.typoSimulation && Math.random() < 0.02) { // 2% chance of typo
            await this.simulateTypo(delay);
        } else {
            this.typingTimeout = setTimeout(() => this.typeNextCharacter(), delay);
        }
    }

    async typeCharacter(char) {
        if (!this.editor) return;

        // Ensure editor still has focus before typing
        await this.ensureGoogleDocsFocus();

        const keyCode = char.charCodeAt(0);
        const isEnter = char === '\n';
        
        console.log(`Flow: Attempting to type character "${char}"`);
        
        // Check if we should use single method to prevent duplicates
        const useSingleMethod = this.settings.singleMethod !== false;
        let methodsAttempted = [];
        
        // If clipboard-only mode is enabled, only use clipboard paste
        if (this.clipboardOnlyMode && !isEnter && char.length === 1) {
            try {
                await navigator.clipboard.writeText(char);
                const pasteSuccess = document.execCommand('paste');
                console.log(`Flow: Clipboard-only mode - paste result: ${pasteSuccess} for "${char}"`);
                return;
            } catch (e) {
                console.log('Flow: Clipboard-only mode failed:', e);
                return;
            }
        }

        // If direct DOM mode is enabled, try to find and manipulate DOM directly
        if (this.directDomMode) {
            try {
                const success = await this.directDomInsert(char, isEnter);
                if (success) {
                    console.log(`Flow: Direct DOM insertion succeeded for "${char}"`);
                    return;
                } else {
                    console.log(`Flow: Direct DOM insertion failed for "${char}"`);
                }
            } catch (e) {
                console.log('Flow: Direct DOM mode failed:', e);
            }
        }
        
        // Method 1: execCommand (try first but don't rely on it exclusively)
        let execSuccess = false;
        try {
            if (isEnter) {
                execSuccess = document.execCommand('insertParagraph', false) || 
                             document.execCommand('insertHTML', false, '<br>');
            } else {
                execSuccess = document.execCommand('insertText', false, char);
            }
            methodsAttempted.push(`execCommand: ${execSuccess}`);
            
            if (execSuccess) {
                console.log(`Flow: execCommand succeeded for "${char}"`);
                if (useSingleMethod) {
                    return; // Exit early only if single method mode AND it worked
                }
            }
        } catch (e) {
            methodsAttempted.push(`execCommand: failed (${e.message})`);
            console.log('Flow: execCommand failed:', e);
        }

        // If single method mode and execCommand worked, we already returned
        // If single method mode and execCommand failed, try keyboard simulation as backup
        if (useSingleMethod && !execSuccess) {
            console.log(`Flow: Single method mode - execCommand failed, trying keyboard simulation as backup`);
        }

        // Method 2: Clipboard paste (try this before keyboard events)
        if (!isEnter && char.length === 1) {
            try {
                await navigator.clipboard.writeText(char);
                const pasteSuccess = document.execCommand('paste');
                methodsAttempted.push(`clipboard: ${pasteSuccess}`);
                if (pasteSuccess) {
                    console.log(`Flow: Clipboard paste succeeded for "${char}"`);
                    if (useSingleMethod) {
                        return; // Exit early in single method mode
                    }
                }
            } catch (e) {
                methodsAttempted.push(`clipboard: failed (${e.message})`);
                console.log('Flow: Clipboard method failed:', e);
            }
        }

        // Method 3: Keyboard event simulation (fallback)
        try {
            if (isEnter) {
                this.simulateKeyPress('Enter', 13);
            } else {
                this.simulateKeyPress(char, keyCode);
            }
            methodsAttempted.push('keyboardEvents: attempted');
            console.log(`Flow: Keyboard simulation attempted for "${char}"`);
            
            if (useSingleMethod) {
                return; // In single method mode, don't try more methods
            }
        } catch (e) {
            methodsAttempted.push(`keyboardEvents: failed (${e.message})`);
            console.log('Flow: Keyboard simulation failed:', e);
        }

        // Only try additional methods if NOT in single method mode
        if (!useSingleMethod) {
            // Method 4: Input event simulation (last resort)
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
        
        console.log(`Flow: Methods attempted for "${char}":`, methodsAttempted);
    }

    async ensureGoogleDocsFocus() {
        // Try multiple methods to ensure Google Docs is focused and ready
        
        // 1. Focus the iframe
        if (this.editor && this.editor.focus) {
            this.editor.focus();
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
        
        // More comprehensive keyboard event simulation for Google Docs
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

        // Create all keyboard events
        const keydownEvent = new KeyboardEvent('keydown', eventOptions);
        const keypressEvent = new KeyboardEvent('keypress', eventOptions);
        const keyupEvent = new KeyboardEvent('keyup', eventOptions);

        console.log(`Flow: Simulating key "${key}" (${keyCode}) on multiple targets`);

        // Try multiple dispatch targets and methods
        const targets = [];
        
        // Add iframe document if accessible
        try {
            if (target && target.tagName === 'IFRAME') {
                const iframeDoc = target.contentDocument || target.contentWindow.document;
                const iframeWin = target.contentWindow;
                if (iframeDoc) {
                    targets.push({ element: iframeDoc, name: 'iframeDoc' });
                    if (iframeDoc.body) {
                        targets.push({ element: iframeDoc.body, name: 'iframeBody' });
                    }
                    if (iframeWin) {
                        targets.push({ element: iframeWin, name: 'iframeWindow' });
                    }
                }
            }
        } catch (e) {
            console.log('Flow: Cannot access iframe content');
        }

        // Add main document targets
        targets.push({ element: target, name: 'iframe' });
        targets.push({ element: document.activeElement, name: 'activeElement' });
        targets.push({ element: document, name: 'document' });
        targets.push({ element: window, name: 'window' });

        // Try dispatching to all targets
        targets.forEach(({ element, name }) => {
            if (element && element.dispatchEvent) {
                try {
                    element.dispatchEvent(keydownEvent);
                    element.dispatchEvent(keypressEvent);
                    element.dispatchEvent(keyupEvent);
                    console.log(`Flow: Dispatched key events to ${name}`);
                } catch (e) {
                    console.log(`Flow: Failed to dispatch to ${name}:`, e.message);
                }
            }
        });
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

    async simulateTypo(baseDelay) {
        // Type a wrong character
        const wrongChars = 'qwertyuiopasdfghjklzxcvbnm';
        const wrongChar = wrongChars[Math.floor(Math.random() * wrongChars.length)];
        
        await this.typeCharacter(wrongChar);
        
        // Wait a bit
        await new Promise(resolve => setTimeout(resolve, baseDelay * 0.5));
        
        // Backspace
        document.execCommand('delete', false);
        
        // Wait again
        await new Promise(resolve => setTimeout(resolve, baseDelay * 0.3));
        
        // Continue with normal typing
        this.typingTimeout = setTimeout(() => this.typeNextCharacter(), baseDelay * 0.2);
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
        
        // Update widget UI
        this.updateWidgetStatus('Flow completed successfully!', 'ready');
        this.updateStepProgress(); // Reset to appropriate step
        this.updateWidgetUI();
        if (this.widgetElements) {
            this.widgetElements.progress.classList.remove('visible');
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

    injectCSS() {
        const css = `
            /* Flow Floating Widget Styles */
            #flow-floating-widget {
                position: fixed;
                top: 20px;
                right: 20px;
                width: 320px;
                background: white;
                border-radius: 12px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
                z-index: 10000;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
                border: 1px solid #e1e5e9;
                transition: all 0.3s ease;
                transform: translateY(0);
            }

            #flow-floating-widget.minimized {
                width: 60px;
                height: 60px;
                border-radius: 50%;
                overflow: hidden;
                cursor: pointer;
            }

            #flow-floating-widget.minimized .flow-widget-content {
                display: none;
            }

            #flow-floating-widget.minimized .flow-minimize-btn {
                display: none;
            }

            #flow-floating-widget.minimized::before {
                content: '⚡';
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                font-size: 24px;
                color: #667eea;
            }

            .flow-widget-header {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 12px 16px;
                border-radius: 12px 12px 0 0;
                display: flex;
                justify-content: space-between;
                align-items: center;
                cursor: move;
                user-select: none;
            }

            .flow-widget-title {
                font-weight: 600;
                font-size: 14px;
            }

            .flow-widget-controls {
                display: flex;
                gap: 8px;
            }

            .flow-minimize-btn,
            .flow-close-btn {
                background: rgba(255, 255, 255, 0.2);
                border: none;
                color: white;
                width: 24px;
                height: 24px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background 0.2s ease;
            }

            .flow-minimize-btn:hover,
            .flow-close-btn:hover {
                background: rgba(255, 255, 255, 0.3);
            }

            .flow-widget-content {
                padding: 16px;
                max-height: 400px;
                overflow-y: auto;
            }

            .flow-steps-guide {
                margin-bottom: 16px;
                border: 1px solid #e1e5e9;
                border-radius: 8px;
                padding: 12px;
                background: #f8f9fa;
            }

            .flow-step {
                display: flex;
                align-items: center;
                gap: 10px;
                margin-bottom: 8px;
                padding: 8px;
                border-radius: 6px;
                transition: all 0.2s ease;
            }

            .flow-step:last-child {
                margin-bottom: 0;
            }

            .flow-step.active {
                background: #e7f3ff;
                border: 1px solid #b3d9ff;
            }

            .flow-step.completed {
                background: #e8f5e8;
                border: 1px solid #c3e6c3;
            }

            .flow-step-number {
                width: 24px;
                height: 24px;
                border-radius: 50%;
                background: #6c757d;
                color: white;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 12px;
                font-weight: 600;
                flex-shrink: 0;
            }

            .flow-step.active .flow-step-number {
                background: #007bff;
                animation: pulse 2s infinite;
            }

            .flow-step.completed .flow-step-number {
                background: #28a745;
            }

            .flow-step-content {
                flex: 1;
            }

            .flow-step-title {
                font-size: 13px;
                font-weight: 600;
                color: #333;
                margin-bottom: 2px;
            }

            .flow-step-desc {
                font-size: 11px;
                color: #6c757d;
            }

            .flow-step-status {
                font-size: 16px;
                flex-shrink: 0;
            }

            .flow-step.active .flow-step-status::before {
                content: '👉';
            }

            .flow-step.completed .flow-step-status::before {
                content: '✅';
            }

            .flow-status {
                display: flex;
                align-items: center;
                gap: 8px;
                margin-bottom: 12px;
                padding: 8px 12px;
                border-radius: 6px;
                font-size: 13px;
                font-weight: 500;
            }

            .flow-status.waiting {
                background: #fff3cd;
                color: #856404;
            }

            .flow-status.ready {
                background: #d4edda;
                color: #155724;
            }

            .flow-status.running {
                background: #cce5ff;
                color: #004085;
            }

            .flow-status.error {
                background: #f8d7da;
                color: #721c24;
            }

            .flow-status-icon {
                width: 12px;
                height: 12px;
                border-radius: 50%;
                flex-shrink: 0;
            }

            .flow-status.waiting .flow-status-icon {
                background: #ffc107;
                animation: pulse 2s infinite;
            }

            .flow-status.ready .flow-status-icon {
                background: #28a745;
            }

            .flow-status.running .flow-status-icon {
                background: #007bff;
                animation: pulse 1s infinite;
            }

            .flow-status.error .flow-status-icon {
                background: #dc3545;
            }

            .flow-text-area {
                width: 100%;
                height: 80px;
                padding: 8px 12px;
                border: 2px solid #e1e5e9;
                border-radius: 6px;
                font-size: 13px;
                font-family: inherit;
                resize: vertical;
                margin-bottom: 12px;
                transition: border-color 0.2s ease;
                box-sizing: border-box;
            }

            .flow-text-area:focus {
                outline: none;
                border-color: #667eea;
                box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
            }

            .flow-controls {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }

            .flow-wpm-control {
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .flow-wpm-label {
                font-size: 12px;
                color: #555;
                min-width: 80px;
            }

            .flow-wpm-slider {
                flex: 1;
                height: 4px;
                border-radius: 2px;
                background: #e1e5e9;
                outline: none;
                -webkit-appearance: none;
                cursor: pointer;
            }

            .flow-wpm-slider::-webkit-slider-thumb {
                -webkit-appearance: none;
                width: 16px;
                height: 16px;
                border-radius: 50%;
                background: #667eea;
                cursor: pointer;
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
            }

            .flow-options {
                display: flex;
                flex-direction: column;
                gap: 6px;
                margin-bottom: 12px;
            }

            .flow-option {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 12px;
                color: #555;
            }

            .flow-option input[type="checkbox"] {
                width: 14px;
                height: 14px;
            }

            .flow-action-buttons {
                display: flex;
                gap: 8px;
            }

            .flow-btn {
                flex: 1;
                padding: 8px 12px;
                border: none;
                border-radius: 6px;
                font-size: 12px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s ease;
            }

            .flow-btn-primary {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
            }

            .flow-btn-primary:hover:not(:disabled) {
                transform: translateY(-1px);
                box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
            }

            .flow-btn-secondary {
                background: #f8f9fa;
                color: #6c757d;
                border: 1px solid #dee2e6;
            }

            .flow-btn-secondary:hover:not(:disabled) {
                background: #e9ecef;
            }

            .flow-btn-danger {
                background: #dc3545;
                color: white;
            }

            .flow-btn-danger:hover:not(:disabled) {
                background: #c82333;
            }

            .flow-btn:disabled {
                opacity: 0.6;
                cursor: not-allowed;
                transform: none;
            }

            .flow-progress {
                margin-top: 12px;
                display: none;
            }

            .flow-progress.visible {
                display: block;
            }

            .flow-progress-bar {
                width: 100%;
                height: 4px;
                background: #e1e5e9;
                border-radius: 2px;
                overflow: hidden;
                margin-bottom: 4px;
            }

            .flow-progress-fill {
                height: 100%;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                width: 0%;
                transition: width 0.3s ease;
            }

            .flow-progress-text {
                font-size: 11px;
                color: #6c757d;
                text-align: center;
            }

            .flow-paste-btn, .flow-force-enable-btn {
                background: #f8f9fa;
                border: 1px solid #dee2e6;
                color: #6c757d;
                padding: 4px 8px;
                border-radius: 4px;
                font-size: 11px;
                cursor: pointer;
                align-self: flex-start;
                margin-bottom: 8px;
                transition: all 0.2s ease;
            }

            .flow-paste-btn:hover, .flow-force-enable-btn:hover {
                background: #e9ecef;
            }

            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.6; }
            }

            #flow-floating-widget.dragging {
                transition: none;
                cursor: move;
            }

            @media (max-width: 768px) {
                #flow-floating-widget {
                    width: 280px;
                    right: 10px;
                    top: 10px;
                }
            }
        `;

        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
        console.log('Flow: CSS injected directly');
    }

    injectFloatingWidget() {
        // Don't inject if widget already exists
        if (document.getElementById('flow-floating-widget')) return;

        // Inject CSS directly to avoid chrome-extension://invalid/ error
        this.injectCSS();

        // Create widget HTML
        const widgetHTML = `
            <div id="flow-floating-widget">
                <div class="flow-widget-header">
                    <span class="flow-widget-title">⚡ Flow</span>
                    <div class="flow-widget-controls">
                        <button class="flow-minimize-btn" title="Minimize">−</button>
                        <button class="flow-close-btn" title="Close">×</button>
                    </div>
                </div>
                <div class="flow-widget-content">
                    <div class="flow-steps-guide">
                        <div class="flow-step" data-step="1">
                            <div class="flow-step-number">1</div>
                            <div class="flow-step-content">
                                <div class="flow-step-title">Add your text</div>
                                <div class="flow-step-desc">Paste or type your content below</div>
                            </div>
                            <div class="flow-step-status">⏳</div>
                        </div>
                        <div class="flow-step" data-step="2">
                            <div class="flow-step-number">2</div>
                            <div class="flow-step-content">
                                <div class="flow-step-title">Click in Google Docs</div>
                                <div class="flow-step-desc">Click where you want to start typing</div>
                            </div>
                            <div class="flow-step-status">⏳</div>
                        </div>
                        <div class="flow-step" data-step="3">
                            <div class="flow-step-number">3</div>
                            <div class="flow-step-content">
                                <div class="flow-step-title">Adjust settings & start</div>
                                <div class="flow-step-desc">Set speed and click Start button</div>
                            </div>
                            <div class="flow-step-status">⏳</div>
                        </div>
                    </div>
                    
                    <div class="flow-status waiting">
                        <div class="flow-status-icon"></div>
                        <span>Step 1: Add your text below</span>
                    </div>
                    
                    <div class="flow-debug-tools" style="display: none;">
                        <div style="font-size: 10px; color: #6c757d; margin-bottom: 6px; text-align: center;">Debug Tools</div>
                        <button class="flow-force-enable-btn" style="background: #ffc107; color: #856404; border: none; padding: 4px 8px; border-radius: 4px; font-size: 11px; margin-bottom: 4px; cursor: pointer;">🔧 Force Enable</button>
                        <button class="flow-test-paste-btn" style="background: #17a2b8; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 11px; margin-bottom: 4px; cursor: pointer;">🧪 Test Paste</button>
                        <button class="flow-multi-method-btn" style="background: #28a745; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 11px; margin-bottom: 4px; cursor: pointer;">🔀 Multi-Method</button>
                        <button class="flow-clipboard-only-btn" style="background: #6f42c1; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 11px; margin-bottom: 4px; cursor: pointer;">📋 Clipboard Only</button>
                        <button class="flow-direct-dom-btn" style="background: #dc3545; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 11px; margin-bottom: 8px; cursor: pointer;">⚡ Direct DOM</button>
                        <button class="flow-toggle-debug-btn" style="background: #6c757d; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 11px; margin-bottom: 8px; cursor: pointer;">Hide Debug</button>
                    </div>
                    <button class="flow-show-debug-btn" style="background: #f8f9fa; border: 1px solid #dee2e6; color: #6c757d; padding: 4px 8px; border-radius: 4px; font-size: 11px; margin-bottom: 8px; cursor: pointer;">🔧 Show Debug Tools</button>
                    
                    <button class="flow-paste-btn">📋 Paste from Clipboard</button>
                    <textarea class="flow-text-area" placeholder="Paste your text here or use the clipboard button above..."></textarea>
                    
                    <div class="flow-text-preview" style="display: none;">
                        <div style="font-size: 11px; color: #6c757d; margin-bottom: 4px;">Cleaned Text Preview:</div>
                        <div class="flow-preview-content" style="background: #f8f9fa; padding: 8px; border-radius: 4px; font-size: 12px; max-height: 60px; overflow-y: auto; border: 1px solid #e1e5e9;"></div>
                        <div class="flow-preview-stats" style="font-size: 10px; color: #6c757d; margin-top: 4px;"></div>
                    </div>
                    
                    <div class="flow-controls">
                        <div class="flow-wpm-control">
                            <span class="flow-wpm-label">Speed: <span class="flow-wpm-value">60</span> WPM</span>
                            <input type="range" class="flow-wpm-slider" min="10" max="200" value="60">
                        </div>
                        
                        <div class="flow-options">
                            <label class="flow-option">
                                <input type="checkbox" class="flow-preserve-formatting" checked>
                                Preserve formatting
                            </label>
                            <label class="flow-option">
                                <input type="checkbox" class="flow-natural-variations">
                                Natural variations
                            </label>
                            <label class="flow-option">
                                <input type="checkbox" class="flow-typo-simulation">
                                Simulate typos
                            </label>
                            <label class="flow-option">
                                <input type="checkbox" class="flow-single-method" checked>
                                Use single typing method (prevents duplicates)
                            </label>
                        </div>
                        
                        <div class="flow-action-buttons">
                            <button class="flow-btn flow-btn-primary flow-start-btn" disabled>▶ Start</button>
                            <button class="flow-btn flow-btn-secondary flow-pause-btn" disabled>⏸ Pause</button>
                            <button class="flow-btn flow-btn-danger flow-stop-btn" disabled>⏹ Stop</button>
                        </div>
                        
                        <div class="flow-progress">
                            <div class="flow-progress-bar">
                                <div class="flow-progress-fill"></div>
                            </div>
                            <div class="flow-progress-text">0% complete</div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Insert widget into page
        const widgetDiv = document.createElement('div');
        widgetDiv.innerHTML = widgetHTML;
        document.body.appendChild(widgetDiv.firstElementChild);

        this.floatingWidget = document.getElementById('flow-floating-widget');
        this.setupFloatingWidgetEvents();
        this.loadWidgetSettings();
        
        // Initial ready state check
        setTimeout(() => {
            this.updateStepProgress();
            this.checkReadyState();
        }, 100);
    }

    setupFloatingWidgetEvents() {
        if (!this.floatingWidget) return;

        // Get elements
        const elements = {
            minimizeBtn: this.floatingWidget.querySelector('.flow-minimize-btn'),
            closeBtn: this.floatingWidget.querySelector('.flow-close-btn'),
            forceEnableBtn: this.floatingWidget.querySelector('.flow-force-enable-btn'),
            testPasteBtn: this.floatingWidget.querySelector('.flow-test-paste-btn'),
            multiMethodBtn: this.floatingWidget.querySelector('.flow-multi-method-btn'),
            clipboardOnlyBtn: this.floatingWidget.querySelector('.flow-clipboard-only-btn'),
            directDomBtn: this.floatingWidget.querySelector('.flow-direct-dom-btn'),
            showDebugBtn: this.floatingWidget.querySelector('.flow-show-debug-btn'),
            toggleDebugBtn: this.floatingWidget.querySelector('.flow-toggle-debug-btn'),
            debugTools: this.floatingWidget.querySelector('.flow-debug-tools'),
            pasteBtn: this.floatingWidget.querySelector('.flow-paste-btn'),
            textArea: this.floatingWidget.querySelector('.flow-text-area'),
            wpmSlider: this.floatingWidget.querySelector('.flow-wpm-slider'),
            wpmValue: this.floatingWidget.querySelector('.flow-wpm-value'),
            startBtn: this.floatingWidget.querySelector('.flow-start-btn'),
            pauseBtn: this.floatingWidget.querySelector('.flow-pause-btn'),
            stopBtn: this.floatingWidget.querySelector('.flow-stop-btn'),
            status: this.floatingWidget.querySelector('.flow-status'),
            progress: this.floatingWidget.querySelector('.flow-progress'),
            progressFill: this.floatingWidget.querySelector('.flow-progress-fill'),
            progressText: this.floatingWidget.querySelector('.flow-progress-text'),
            preserveFormatting: this.floatingWidget.querySelector('.flow-preserve-formatting'),
            naturalVariations: this.floatingWidget.querySelector('.flow-natural-variations'),
            typoSimulation: this.floatingWidget.querySelector('.flow-typo-simulation'),
            singleMethod: this.floatingWidget.querySelector('.flow-single-method'),
            header: this.floatingWidget.querySelector('.flow-widget-header'),
            textPreview: this.floatingWidget.querySelector('.flow-text-preview'),
            previewContent: this.floatingWidget.querySelector('.flow-preview-content'),
            previewStats: this.floatingWidget.querySelector('.flow-preview-stats'),
            stepsGuide: this.floatingWidget.querySelector('.flow-steps-guide'),
            step1: this.floatingWidget.querySelector('[data-step="1"]'),
            step2: this.floatingWidget.querySelector('[data-step="2"]'),
            step3: this.floatingWidget.querySelector('[data-step="3"]')
        };

        // Minimize/maximize
        elements.minimizeBtn.addEventListener('click', () => {
            this.floatingWidget.classList.toggle('minimized');
        });

        // Click on minimized widget to maximize
        this.floatingWidget.addEventListener('click', (e) => {
            if (this.floatingWidget.classList.contains('minimized') && !this.dragState.isDragging) {
                this.floatingWidget.classList.remove('minimized');
            }
        });

        // Close widget
        elements.closeBtn.addEventListener('click', () => {
            this.floatingWidget.style.display = 'none';
        });

        // Force enable button (debug)
        elements.forceEnableBtn.addEventListener('click', () => {
            this.editorClickDetected = true;
            this.editor = this.findGoogleDocsEditor() || document.body; // Fallback to body
            this.updateWidgetStatus('Force enabled! Editor set to: ' + (this.editor.className || 'body'), 'ready');
            this.checkReadyState();
            console.log('Flow: Force enabled, editor set to:', this.editor);
        });

        // Test paste button (debug)
        elements.testPasteBtn.addEventListener('click', async () => {
            const testText = "TEST PASTE - Hello from Flow!";
            try {
                await this.ensureGoogleDocsFocus();
                await navigator.clipboard.writeText(testText);
                
                // Try multiple paste methods
                let success = false;
                
                // Method 1: execCommand paste
                success = document.execCommand('paste');
                if (success) {
                    this.updateWidgetStatus('Test paste successful via execCommand!', 'ready');
                    return;
                }

                // Method 2: Keyboard shortcut simulation
                const ctrlV = new KeyboardEvent('keydown', {
                    key: 'v',
                    code: 'KeyV',
                    keyCode: 86,
                    ctrlKey: true,
                    bubbles: true,
                    cancelable: true
                });
                document.dispatchEvent(ctrlV);
                
                this.updateWidgetStatus('Test paste attempted - check Google Docs', 'ready');
                console.log('Flow: Test paste attempted with text:', testText);
                
            } catch (err) {
                this.updateWidgetStatus('Test paste failed: ' + err.message, 'error');
                console.error('Flow: Test paste error:', err);
            }
        });

        // Multi-method test button (debug)
        elements.multiMethodBtn.addEventListener('click', () => {
            // Temporarily disable single method mode for testing
            elements.singleMethod.checked = false;
            this.updateWidgetStatus('Multi-method mode enabled for testing', 'ready');
            console.log('Flow: Switched to multi-method mode for debugging');
        });

        // Clipboard-only mode button (debug)
        elements.clipboardOnlyBtn.addEventListener('click', () => {
            // Force clipboard-only mode
            this.clipboardOnlyMode = true;
            this.updateWidgetStatus('Clipboard-only mode enabled', 'ready');
            console.log('Flow: Switched to clipboard-only mode');
        });

        // Direct DOM manipulation button (debug)
        elements.directDomBtn.addEventListener('click', () => {
            // Force direct DOM mode
            this.directDomMode = true;
            this.updateWidgetStatus('Direct DOM mode enabled - WARNING: May not create proper edit history', 'error');
            console.log('Flow: Switched to direct DOM manipulation mode');
        });

        // Debug tools toggle
        elements.showDebugBtn.addEventListener('click', () => {
            elements.debugTools.style.display = 'block';
            elements.showDebugBtn.style.display = 'none';
        });

        elements.toggleDebugBtn.addEventListener('click', () => {
            elements.debugTools.style.display = 'none';
            elements.showDebugBtn.style.display = 'block';
        });

        // Paste from clipboard
        elements.pasteBtn.addEventListener('click', async () => {
            try {
                const text = await navigator.clipboard.readText();
                elements.textArea.value = text;
                this.updateWidgetStatus('Text pasted! Now click in Google Docs where you want to start typing.', 'ready');
                this.updateTextPreview();
                this.updateStepProgress();
                this.checkReadyState();
            } catch (err) {
                this.updateWidgetStatus('Failed to read clipboard', 'error');
            }
        });

        // WPM slider
        elements.wpmSlider.addEventListener('input', (e) => {
            elements.wpmValue.textContent = e.target.value;
            this.saveWidgetSettings();
        });

        // Start button
        elements.startBtn.addEventListener('click', () => {
            this.startTypingFromWidget();
        });

        // Pause button
        elements.pauseBtn.addEventListener('click', () => {
            this.togglePause();
        });

        // Stop button
        elements.stopBtn.addEventListener('click', () => {
            this.stopTyping();
        });

        // Text area changes
        elements.textArea.addEventListener('input', () => {
            this.updateTextPreview();
            this.updateStepProgress();
            this.checkReadyState();
        });

        // Settings changes
        [elements.preserveFormatting, elements.naturalVariations, elements.typoSimulation, elements.singleMethod]
            .forEach(el => el.addEventListener('change', () => {
                this.saveWidgetSettings();
                if (el === elements.preserveFormatting) {
                    this.updateTextPreview(); // Update preview when formatting option changes
                }
            }));

        // Dragging functionality
        this.setupDragging(elements.header);

        this.widgetElements = elements;
    }

    setupDragging(header) {
        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('button')) return; // Don't drag when clicking buttons
            
            this.dragState.isDragging = true;
            this.dragState.startX = e.clientX;
            this.dragState.startY = e.clientY;
            
            const rect = this.floatingWidget.getBoundingClientRect();
            this.dragState.startLeft = rect.left;
            this.dragState.startTop = rect.top;
            
            this.floatingWidget.classList.add('dragging');
            
            document.addEventListener('mousemove', this.handleDrag.bind(this));
            document.addEventListener('mouseup', this.handleDragEnd.bind(this));
        });
    }

    handleDrag(e) {
        if (!this.dragState.isDragging) return;
        
        const deltaX = e.clientX - this.dragState.startX;
        const deltaY = e.clientY - this.dragState.startY;
        
        const newLeft = Math.max(0, Math.min(window.innerWidth - this.floatingWidget.offsetWidth, this.dragState.startLeft + deltaX));
        const newTop = Math.max(0, Math.min(window.innerHeight - this.floatingWidget.offsetHeight, this.dragState.startTop + deltaY));
        
        this.floatingWidget.style.left = newLeft + 'px';
        this.floatingWidget.style.top = newTop + 'px';
        this.floatingWidget.style.right = 'auto';
    }

    handleDragEnd() {
        this.dragState.isDragging = false;
        this.floatingWidget.classList.remove('dragging');
        document.removeEventListener('mousemove', this.handleDrag);
        document.removeEventListener('mouseup', this.handleDragEnd);
    }

    setupEditorClickDetection() {
        // Listen for clicks on the document
        document.addEventListener('click', (e) => {
            const clickedElement = e.target;
            
            // Check if click is in Google Docs editor
            if (this.isClickInEditor(clickedElement)) {
                this.onEditorClicked();
            }
        }, true);

        // Also listen for focus events
        document.addEventListener('focusin', (e) => {
            if (this.isClickInEditor(e.target)) {
                this.onEditorClicked();
            }
        });
    }

    isClickInEditor(element) {
        if (!element) return false;
        
        // Check if element is or is inside a Google Docs editor
        // Based on the provided HTML structure: canvas.kix-canvas-tile-content inside div.kix-page-paginated
        const editorSelectors = [
            '.kix-canvas-tile-content',
            '.kix-page-paginated',
            '.kix-page-content-wrap',
            '.kix-page-column-content',
            '.docs-text-editor',
            '[contenteditable="true"]',
            '.docs-texteventtarget-iframe',
            '.kix-appview-editor'
        ];

        for (const selector of editorSelectors) {
            if (element.matches && element.matches(selector)) {
                console.log(`Flow: Click detected on editor element: ${selector}`);
                return true;
            }
            if (element.closest && element.closest(selector)) {
                console.log(`Flow: Click detected inside editor container: ${selector}`);
                return true;
            }
        }

        // Also check if clicking on the canvas element specifically
        if (element.tagName === 'CANVAS' && element.classList.contains('kix-canvas-tile-content')) {
            console.log('Flow: Click detected on Google Docs canvas');
            return true;
        }

        return false;
    }

    onEditorClicked() {
        if (!this.editorClickDetected) {
            this.editorClickDetected = true;
            this.editor = this.findGoogleDocsEditor();
            
            if (this.editor) {
                console.log('Flow: Google Docs editor detected:', this.editor);
                this.updateWidgetStatus('Perfect! Now adjust your settings and click Start.', 'ready');
                this.updateStepProgress();
                this.checkReadyState();
            } else {
                console.log('Flow: Editor click detected but could not find editor element');
                // Try again after a short delay
                setTimeout(() => {
                    this.editor = this.findGoogleDocsEditor();
                    if (this.editor) {
                        console.log('Flow: Google Docs editor found on retry:', this.editor);
                        this.updateWidgetStatus('Perfect! Now adjust your settings and click Start.', 'ready');
                        this.updateStepProgress();
                        this.checkReadyState();
                    } else {
                        this.updateWidgetStatus('Could not find Google Docs editor. Try clicking in the document again.', 'error');
                    }
                }, 500);
            }
        }
    }

    checkReadyState() {
        if (!this.widgetElements) return;
        
        const hasText = this.widgetElements.textArea.value.trim().length > 0;
        const hasEditor = this.editorClickDetected && this.editor;
        const notTyping = !this.isTyping;
        
        console.log('Flow: Checking ready state:', {
            hasText,
            hasEditor: hasEditor,
            editorClickDetected: this.editorClickDetected,
            editor: this.editor,
            notTyping,
            isTyping: this.isTyping
        });
        
        const shouldEnable = hasText && hasEditor && notTyping;
        this.widgetElements.startBtn.disabled = !shouldEnable;
        
        if (shouldEnable) {
            console.log('Flow: Start button enabled');
        } else {
            console.log('Flow: Start button disabled - missing requirements');
        }
    }

    updateWidgetStatus(message, type) {
        if (!this.widgetElements) return;
        
        this.widgetElements.status.className = `flow-status ${type}`;
        this.widgetElements.status.querySelector('span').textContent = message;
    }

    updateStepProgress() {
        if (!this.widgetElements) return;
        
        const hasText = this.widgetElements.textArea.value.trim().length > 0;
        const hasEditor = this.editorClickDetected && this.editor;
        
        // Reset all steps
        this.widgetElements.step1.classList.remove('active', 'completed');
        this.widgetElements.step2.classList.remove('active', 'completed');
        this.widgetElements.step3.classList.remove('active', 'completed');
        
        if (hasText && hasEditor) {
            // Both text and editor are ready - activate step 3
            this.widgetElements.step1.classList.add('completed');
            this.widgetElements.step2.classList.add('completed');
            this.widgetElements.step3.classList.add('active');
        } else if (hasText) {
            // Text is ready, need editor - activate step 2
            this.widgetElements.step1.classList.add('completed');
            this.widgetElements.step2.classList.add('active');
            this.updateWidgetStatus('Great! Now click in Google Docs where you want to start typing.', 'ready');
        } else {
            // Need text - activate step 1
            this.widgetElements.step1.classList.add('active');
        }
    }

    updateStepsForTyping() {
        if (!this.widgetElements) return;
        
        // Mark all steps as completed when typing starts
        this.widgetElements.step1.classList.remove('active');
        this.widgetElements.step1.classList.add('completed');
        this.widgetElements.step2.classList.remove('active');
        this.widgetElements.step2.classList.add('completed');
        this.widgetElements.step3.classList.remove('active');
        this.widgetElements.step3.classList.add('completed');
    }

    startTypingFromWidget() {
        if (!this.widgetElements) return;
        
        const settings = {
            text: this.widgetElements.textArea.value.trim(),
            wpm: parseInt(this.widgetElements.wpmSlider.value),
            preserveFormatting: this.widgetElements.preserveFormatting.checked,
            naturalVariations: this.widgetElements.naturalVariations.checked,
            typoSimulation: this.widgetElements.typoSimulation.checked,
            singleMethod: this.widgetElements.singleMethod.checked
        };

        this.startTyping(settings);
    }

    updateWidgetProgress(current, total, percentage) {
        if (!this.widgetElements) return;
        
        this.widgetElements.progress.classList.add('visible');
        this.widgetElements.progressFill.style.width = `${percentage}%`;
        this.widgetElements.progressText.textContent = `${Math.round(percentage)}% complete (${current}/${total})`;
    }

    updateWidgetUI() {
        if (!this.widgetElements) return;
        
        this.widgetElements.startBtn.disabled = this.isTyping;
        this.widgetElements.pauseBtn.disabled = !this.isTyping;
        this.widgetElements.stopBtn.disabled = !this.isTyping;
        this.widgetElements.pauseBtn.textContent = this.isPaused ? '▶ Resume' : '⏸ Pause';
        this.widgetElements.textArea.disabled = this.isTyping;
    }

    saveWidgetSettings() {
        if (!this.widgetElements) return;
        
        const settings = {
            wpm: parseInt(this.widgetElements.wpmSlider.value),
            preserveFormatting: this.widgetElements.preserveFormatting.checked,
            naturalVariations: this.widgetElements.naturalVariations.checked,
            typoSimulation: this.widgetElements.typoSimulation.checked,
            singleMethod: this.widgetElements.singleMethod.checked
        };
        
        chrome.storage.sync.set({ flowSettings: settings });
    }

    async loadWidgetSettings() {
        if (!this.widgetElements) return;
        
        try {
            const result = await chrome.storage.sync.get(['flowSettings']);
            if (result.flowSettings) {
                const settings = result.flowSettings;
                this.widgetElements.wpmSlider.value = settings.wpm || 60;
                this.widgetElements.wpmValue.textContent = settings.wpm || 60;
                this.widgetElements.preserveFormatting.checked = settings.preserveFormatting !== false;
                this.widgetElements.naturalVariations.checked = settings.naturalVariations || false;
                this.widgetElements.typoSimulation.checked = settings.typoSimulation || false;
                this.widgetElements.singleMethod.checked = settings.singleMethod !== false;
            }
        } catch (err) {
            console.log('Failed to load settings:', err);
        }
        
        // Initial text preview update
        this.updateTextPreview();
        this.updateStepProgress();
    }

    updateTextPreview() {
        if (!this.widgetElements) return;
        
        const originalText = this.widgetElements.textArea.value;
        if (!originalText.trim()) {
            this.widgetElements.textPreview.style.display = 'none';
            return;
        }

        // Show preview
        this.widgetElements.textPreview.style.display = 'block';
        
        // Process text with formatting if enabled
        let processedText, formattingCount = 0;
        if (this.widgetElements.preserveFormatting.checked) {
            const parsed = this.parseFormattingMarkers(originalText);
            processedText = this.cleanAndNormalizeText(parsed.cleanText);
            formattingCount = parsed.formattingMap.size;
        } else {
            processedText = this.cleanAndNormalizeText(originalText);
        }

        // Update preview content
        this.widgetElements.previewContent.textContent = processedText.substring(0, 200) + (processedText.length > 200 ? '...' : '');
        
        // Update stats
        const originalLength = originalText.length;
        const cleanedLength = processedText.length;
        const removedChars = originalLength - cleanedLength;
        
        let statsText = `${cleanedLength} characters`;
        if (removedChars > 0) {
            statsText += ` (${removedChars} removed)`;
        }
        if (formattingCount > 0) {
            statsText += ` • ${formattingCount} formatting markers`;
        }
        
        this.widgetElements.previewStats.textContent = statsText;
    }

    async directDomInsert(char, isEnter) {
        console.log('Flow: Attempting direct DOM manipulation...');
        
        // Try to find Google Docs content elements
        const possibleTargets = [
            // Look for text content containers
            '.kix-lineview-text-block',
            '.kix-lineview',
            '.kix-wordhtmlgenerator-word-node',
            '[data-kix-text="true"]',
            // Look for contenteditable areas
            '[contenteditable="true"]',
            // Canvas fallback - look for associated text elements
            '.kix-canvas-tile-content'
        ];

        for (const selector of possibleTargets) {
            const elements = document.querySelectorAll(selector);
            console.log(`Flow: Found ${elements.length} elements for selector: ${selector}`);
            
            for (const element of elements) {
                if (this.isValidTextTarget(element)) {
                    try {
                        if (isEnter) {
                            // Create new paragraph/line
                            const newElement = element.cloneNode(false);
                            newElement.textContent = '';
                            element.parentNode.insertBefore(newElement, element.nextSibling);
                            console.log('Flow: Created new line via DOM');
                            return true;
                        } else {
                            // Insert text character
                            if (element.textContent !== undefined) {
                                element.textContent += char;
                                console.log(`Flow: Inserted "${char}" into DOM element:`, element);
                                return true;
                            } else if (element.innerText !== undefined) {
                                element.innerText += char;
                                console.log(`Flow: Inserted "${char}" into DOM element (innerText):`, element);
                                return true;
                            }
                        }
                    } catch (e) {
                        console.log(`Flow: Failed to manipulate element:`, e);
                        continue;
                    }
                }
            }
        }

        // Last resort: try to create a new text node and insert it
        try {
            const canvas = document.querySelector('.kix-canvas-tile-content');
            if (canvas && canvas.parentElement) {
                const textDiv = document.createElement('div');
                textDiv.style.position = 'absolute';
                textDiv.style.top = '100px';
                textDiv.style.left = '100px';
                textDiv.style.zIndex = '9999';
                textDiv.style.background = 'white';
                textDiv.style.padding = '10px';
                textDiv.textContent = `Flow inserted: ${char}`;
                canvas.parentElement.appendChild(textDiv);
                console.log('Flow: Created overlay text element as last resort');
                return true;
            }
        } catch (e) {
            console.log('Flow: Last resort DOM manipulation failed:', e);
        }

        return false;
    }

    isValidTextTarget(element) {
        return element && 
               element.offsetParent && 
               element.offsetHeight > 0 && 
               element.offsetWidth > 0 &&
               (element.textContent !== undefined || element.innerText !== undefined);
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
