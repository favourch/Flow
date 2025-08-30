# Flow Chrome Extension - Installation Guide

## Quick Start

### 1. Load the Extension
1. Open Google Chrome
2. Navigate to `chrome://extensions/`
3. Enable **"Developer mode"** (toggle in the top-right corner)
4. Click **"Load unpacked"**
5. Select the `Flow` directory (this folder)
6. The Flow extension should now appear in your extensions list

### 2. Test the Extension

#### Method 1: Floating Widget (Recommended)
1. Go to [Google Docs](https://docs.google.com) and create a new document
2. **Click anywhere in the Google Docs editor** - a floating Flow widget will automatically appear!
3. Copy content from `test-content.txt` and paste it into the widget's text area
4. Set your desired WPM (try 60 WPM to start)
5. Click **"▶ Start"** and watch the magic happen!

#### Method 2: Traditional Popup
1. Go to [Google Docs](https://docs.google.com) and create a new document
2. Click inside the Google Docs editor first
3. Click the Flow extension icon in the Chrome toolbar
4. Follow steps 3-5 from Method 1

**Note**: The floating widget is much more convenient as it automatically detects when you click in the editor and stays visible during typing!

## Troubleshooting

### Extension Not Appearing
- Make sure "Developer mode" is enabled in chrome://extensions/
- Try refreshing the extensions page
- Check that all files are in the correct location

### "Could not find Google Docs editor" Error
- Make sure you're on a docs.google.com page
- Wait for Google Docs to fully load before starting
- Try refreshing the Google Docs page
- Ensure you're in edit mode (not view-only)

### Typing Not Working
- Make sure the Google Docs document is focused (click in the editor)
- Try a lower WPM speed (30-60 WPM)
- Disable browser extensions that might interfere
- Check the browser console for error messages

## Optional: Generate Proper Icons

The extension comes with placeholder icon files. For better icons:

1. Open `icon-converter.html` in your browser
2. Download the generated PNG files
3. Replace the existing icon files in the `icons/` folder
4. Reload the extension in chrome://extensions/

## Features to Test

- **Basic Typing**: Paste text and watch it type naturally
- **Speed Control**: Try different WPM settings (10-200)
- **Natural Variations**: Enable for more realistic typing patterns
- **Typo Simulation**: Watch it make and correct mistakes
- **Pause/Resume**: Control the typing process
- **Progress Tracking**: Monitor typing progress in real-time

## Next Steps

Once installed and tested:
- Bookmark your favorite Google Docs for quick access
- Experiment with different content types and formatting
- Try the natural variations and typo simulation features
- Use the clipboard paste feature for quick content input

Enjoy your new natural typing simulator! 🚀
