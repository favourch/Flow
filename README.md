# Flow - Natural Typing Simulator

A Chrome extension that simulates human typing in Google Docs by replaying pre-written content word by word at customizable WPM speeds.

## Features

- **Natural Typing Simulation**: Paste content and watch it get "typed" naturally into Google Docs
- **Customizable Speed**: Set typing speed from 10-200 WPM
- **Smart Text Cleaning**: Automatically normalizes UTF characters, smart quotes, em-dashes, and special symbols
- **Format Preservation**: Supports markdown-style formatting (**bold**, *italic*) with Google Docs shortcuts
- **Text Preview**: Live preview of cleaned text with character count and formatting detection
- **Natural Variations**: Optional random pauses and speed variations for more realistic typing
- **Typo Simulation**: Optional typos with corrections for authentic typing patterns
- **Progress Tracking**: Real-time progress updates with pause/resume functionality
- **Settings Persistence**: Remembers your preferences across sessions

## Installation

1. **Prepare Icons** (Optional):
   - The extension includes placeholder icon files
   - For proper icons, convert `icons/icon.svg` to PNG format:
     - `icon16.png` (16x16 pixels)
     - `icon48.png` (48x48 pixels) 
     - `icon128.png` (128x128 pixels)

2. **Load Extension**:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select the Flow directory

## Usage

### Floating Widget Mode (Recommended)
1. **Open Google Docs** in a Chrome tab
2. **Click anywhere in the Google Docs editor** - a floating Flow widget will appear
3. **The widget automatically detects** when you've clicked in the editor
4. **Paste your content** into the widget's text area (or use "Paste from Clipboard")
5. **Set your preferred WPM** using the slider (10-200 WPM)
6. **Configure options**:
   - ✅ **Preserve formatting**: Converts **bold** and *italic* markdown to Google Docs formatting
   - ✅ **Natural variations**: Adds random pauses and speed changes
   - ✅ **Simulate typos**: Occasionally makes and corrects mistakes
7. **Review the text preview** to see cleaned text and formatting markers
8. **Click "Start"** - Flow begins typing immediately!
8. **Drag the widget** by its header to reposition it
9. **Minimize/maximize** the widget using the controls

### Traditional Popup Mode
1. **Open Google Docs** and click in the editor first
2. **Click the Flow extension icon** in the toolbar
3. **Follow steps 4-7** from floating widget mode

## Technical Details

### Architecture
- **Manifest V3** Chrome extension
- **Popup Interface**: HTML/CSS/JS for user controls
- **Content Script**: Injected into Google Docs for typing simulation
- **Background Script**: Service worker for settings and coordination

### Typing Engine
- Uses keyboard events, `document.execCommand()`, and `InputEvent` APIs
- Simulates real keystrokes for authentic edit history
- Handles formatting preservation and natural variations
- Implements typo simulation with backspace corrections

### Text Processing
- **Unicode Normalization**: Converts text to NFD format for consistency
- **Smart Character Replacement**: 
  - Smart quotes → Regular quotes (" ' → " ')
  - Em/En dashes → Hyphens (— – → -)
  - Ellipsis → Three dots (… → ...)
  - Non-breaking spaces → Regular spaces
  - Copyright/Trademark symbols → Text equivalents (© → (c), ™ → (TM))
- **Markdown Formatting**: Converts **bold** and *italic* markers to Google Docs shortcuts
- **Whitespace Cleanup**: Normalizes multiple spaces and removes zero-width characters

### Compatibility
- Works with Google Docs (docs.google.com)
- Requires Chrome with Manifest V3 support
- Tested on modern Chrome versions

## Development

### File Structure
```
Flow/
├── manifest.json          # Extension manifest
├── popup.html            # Extension popup UI
├── popup.css             # Popup styling
├── popup.js              # Popup functionality
├── content.js            # Google Docs integration
├── background.js         # Service worker
├── icons/                # Extension icons
│   ├── icon.svg         # Source SVG icon
│   ├── icon16.png       # 16x16 icon
│   ├── icon48.png       # 48x48 icon
│   └── icon128.png      # 128x128 icon
└── README.md            # This file
```

### Key Components

#### FlowPopup (popup.js)
- Manages UI interactions
- Handles settings persistence
- Communicates with content script

#### FlowTypingEngine (content.js)
- Finds Google Docs editor
- Simulates keystroke events
- Handles typing speed and variations
- Implements typo simulation

#### FlowBackground (background.js)
- Manages extension lifecycle
- Handles settings storage
- Ensures content script injection

## Troubleshooting

### Common Issues

**"Please open Google Docs first"**
- Make sure you're on a docs.google.com page
- Refresh the page if the extension was just installed

**"Could not find Google Docs editor"**
- Wait for Google Docs to fully load
- Try refreshing the page
- Make sure you're in edit mode (not view-only)

**Typing seems choppy or inconsistent**
- Try disabling "Natural typing variations"
- Reduce WPM speed for more consistent timing
- Check if other extensions are interfering

**Extension popup doesn't appear**
- Reload the extension in chrome://extensions/
- Check that the extension is enabled
- Try restarting Chrome

### Performance Notes
- Higher WPM speeds (>100) may appear less natural
- Very long texts may take significant time to complete
- Typo simulation adds ~2-5% additional time

## Privacy & Security

- **No data collection**: All processing happens locally
- **No external requests**: Extension works entirely offline
- **Storage**: Only saves user preferences locally
- **Permissions**: Only accesses Google Docs tabs when active

## License

This is a concept implementation. Use responsibly and in accordance with Google's Terms of Service.

---

**Note**: This extension is designed for legitimate use cases such as content creation, testing, and accessibility. Please use responsibly and ethically.
