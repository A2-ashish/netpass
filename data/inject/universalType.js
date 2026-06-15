// Universal Type Coding — Types clipboard text character-by-character into any code editor.
// Supports: Ace, Monaco, CodeMirror 6, CodeMirror 5, <textarea>/<input>, contentEditable,
//           hidden textarea search, and execCommand fallback for unknown/custom editors.
// Triggered by ALT+Shift+U (Ctrl+Shift+U on Mac).
// Runs in MAIN world so it can access editor globals (ace, monaco, CodeMirror, etc.).

(function () {
    'use strict';

    // Use shared isMac variable if it exists, otherwise declare it
    if (typeof window.isMac === 'undefined') {
        window.isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0 ||
                       navigator.userAgent.toUpperCase().indexOf('MAC') >= 0;
    }

    // ── State ───────────────────────────────────────────────────────────
    let _utIsTyping = false;         // Is typing currently in progress?
    let _utShouldStop = false;       // Stop signal (Backspace)

    // ── Editor Detection Waterfall ──────────────────────────────────────
    // Returns { type: string, instance: object, element: Element } or null

    function detectEditor() {
        // 1. Ace Editor
        try {
            const aceEls = document.querySelectorAll('.ace_editor');
            for (const el of aceEls) {
                try {
                    const ed = ace.edit(el);
                    if (ed && !ed.getReadOnly()) {
                        console.log('[UniversalType] Detected: Ace editor');
                        return { type: 'ace', instance: ed, element: el };
                    }
                } catch (e) { /* skip read-only or broken instance */ }
            }
            // Also try the specific answer editor (examly)
            const answerEl = document.querySelector('[aria-labelledby="editor-answer"]');
            if (answerEl) {
                try {
                    const ed = ace.edit(answerEl);
                    if (ed) {
                        console.log('[UniversalType] Detected: Ace editor (examly answer)');
                        return { type: 'ace', instance: ed, element: answerEl };
                    }
                } catch (e) { /* ignore */ }
            }
        } catch (e) { /* ace not present on this page */ }

        // 2. Monaco Editor
        try {
            if (typeof monaco !== 'undefined' && window.monaco && window.monaco.editor) {
                const editors = window.monaco.editor.getEditors();
                if (editors && editors.length > 0) {
                    // Pick the first non-readonly editor, or the first one
                    for (const ed of editors) {
                        try {
                            if (!ed.getOption(monaco.editor.EditorOption.readOnly)) {
                                console.log('[UniversalType] Detected: Monaco editor (API)');
                                return { type: 'monaco', instance: ed, element: null };
                            }
                        } catch (e) { /* try next */ }
                    }
                    // Fallback: first editor
                    console.log('[UniversalType] Detected: Monaco editor (API fallback)');
                    return { type: 'monaco', instance: editors[0], element: null };
                }
            }
        } catch (e) { /* monaco not present */ }

        // Monaco fallback: DOM-based detection
        try {
            const monacoEl = document.querySelector('.monaco-editor, .hr-monaco-editor');
            if (monacoEl) {
                console.log('[UniversalType] Detected: Monaco editor (DOM)');
                return { type: 'monaco-dom', instance: null, element: monacoEl };
            }
        } catch (e) { /* ignore */ }

        // 3. CodeMirror 6
        try {
            const cm6El = document.querySelector('.cm-editor');
            if (cm6El && cm6El.cmView && cm6El.cmView.view) {
                console.log('[UniversalType] Detected: CodeMirror 6');
                return { type: 'cm6', instance: cm6El.cmView.view, element: cm6El };
            }
        } catch (e) { /* cm6 not present */ }

        // 4. CodeMirror 5
        try {
            const cm5El = document.querySelector('.CodeMirror');
            if (cm5El && cm5El.CodeMirror) {
                console.log('[UniversalType] Detected: CodeMirror 5');
                return { type: 'cm5', instance: cm5El.CodeMirror, element: cm5El };
            }
        } catch (e) { /* cm5 not present */ }

        // 5. Active element: <textarea> or <input>
        const active = document.activeElement;
        if (active && (active.tagName === 'TEXTAREA' || (active.tagName === 'INPUT' && active.type === 'text'))) {
            console.log('[UniversalType] Detected: textarea/input');
            return { type: 'textarea', instance: null, element: active };
        }

        // 6. Active element: contentEditable
        if (active && active.isContentEditable) {
            console.log('[UniversalType] Detected: contentEditable');
            return { type: 'contenteditable', instance: null, element: active };
        }

        // 7. Hidden textarea search — many editors (including custom/proprietary ones)
        //    use a hidden <textarea> for keyboard input capture. If the user clicked inside
        //    an editor container, the textarea might be a child/sibling rather than the
        //    activeElement itself.
        if (active) {
            // Search within the focused element and its ancestors for a textarea
            let searchEl = active;
            for (let depth = 0; depth < 5 && searchEl; depth++) {
                const textarea = searchEl.querySelector('textarea');
                if (textarea) {
                    console.log('[UniversalType] Detected: hidden textarea (ancestor search, depth:', depth, ')');
                    textarea.focus();
                    return { type: 'textarea', instance: null, element: textarea };
                }
                searchEl = searchEl.parentElement;
            }
        }

        // 8. execCommand fallback — works on ANY focused editable context regardless
        //    of editor framework. Tests if the focused element accepts text input at all.
        if (active && active !== document.body && active !== document.documentElement) {
            // Test if execCommand will work by checking if the element is in an editable context
            const isEditable = active.isContentEditable ||
                               active.tagName === 'TEXTAREA' ||
                               active.tagName === 'INPUT' ||
                               (active.getAttribute && active.getAttribute('role') === 'textbox') ||
                               (active.getAttribute && active.getAttribute('contenteditable') === 'true') ||
                               active.closest('[contenteditable="true"]') ||
                               active.closest('[role="textbox"]') ||
                               active.closest('.ace_editor') ||
                               active.closest('.monaco-editor') ||
                               active.closest('.cm-editor') ||
                               active.closest('.CodeMirror');
            if (isEditable) {
                console.log('[UniversalType] Detected: execCommand fallback (element has editable context)');
                return { type: 'execcommand', instance: null, element: active };
            }
        }

        // Nothing found
        console.log('[UniversalType] No supported editor found on this page');
        return null;
    }

    // ── Typing Strategies ───────────────────────────────────────────────

    async function typeCharAce(editor, char) {
        if (char === '\n') {
            editor.setValue(editor.getValue() + '\n');
        } else {
            editor.setValue(editor.getValue() + char);
        }
        editor.clearSelection();
        editor.navigateFileEnd();
    }

    async function typeCharMonaco(editor, char) {
        const model = editor.getModel();
        if (!model) return;
        const lastLine = model.getLineCount();
        const lastCol = model.getLineMaxColumn(lastLine);
        const range = new monaco.Range(lastLine, lastCol, lastLine, lastCol);
        editor.executeEdits('universalType', [{
            range: range,
            text: char,
            forceMoveMarkers: true
        }]);
        // Move cursor to end
        const newLastLine = model.getLineCount();
        const newLastCol = model.getLineMaxColumn(newLastLine);
        editor.setPosition({ lineNumber: newLastLine, column: newLastCol });
        editor.revealPosition({ lineNumber: newLastLine, column: newLastCol });
    }

    async function typeCharMonacoDom(element, char) {
        // Fallback: focus the textarea inside Monaco and dispatch keyboard events
        const textarea = element.querySelector('textarea.inputarea') ||
                         element.querySelector('textarea');
        if (textarea) {
            textarea.focus();
            // Use InputEvent to simulate character input
            textarea.dispatchEvent(new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertText',
                data: char
            }));
            textarea.dispatchEvent(new InputEvent('input', {
                bubbles: true,
                cancelable: false,
                inputType: 'insertText',
                data: char
            }));
        }
    }

    async function typeCharCM6(view, char) {
        const pos = view.state.doc.length;
        view.dispatch({
            changes: { from: pos, to: pos, insert: char }
        });
    }

    async function typeCharCM5(cm, char) {
        const cursor = cm.getCursor();
        cm.replaceRange(char, cursor);
    }

    async function typeCharTextarea(element, char) {
        const start = element.selectionStart || 0;
        const end = element.selectionEnd || 0;
        const text = element.value || '';
        element.value = text.substring(0, start) + char + text.substring(end);
        element.setSelectionRange(start + 1, start + 1);

        element.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: char
        }));
    }

    async function typeCharContentEditable(element, char) {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const textNode = document.createTextNode(char);
            range.insertNode(textNode);
            range.setStartAfter(textNode);
            range.setEndAfter(textNode);
            selection.removeAllRanges();
            selection.addRange(range);
        }

        element.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: char
        }));
    }

    async function typeCharExecCommand(element, char) {
        // Universal fallback: uses document.execCommand('insertText')
        // Works on any focused editable context regardless of editor framework.
        element.focus();
        const success = document.execCommand('insertText', false, char);
        if (!success) {
            // If execCommand fails, try dispatching InputEvent directly
            element.dispatchEvent(new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertText',
                data: char
            }));
            element.dispatchEvent(new InputEvent('input', {
                bubbles: true,
                cancelable: false,
                inputType: 'insertText',
                data: char
            }));
        }
    }

    // ── Main Typing Loop ────────────────────────────────────────────────

    async function typeTextIntoEditor(editorInfo, text) {
        // Normalize line endings and filter tabs
        const textToType = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\t/g, '    ');

        // For Ace, clear the editor first (match exam.js behavior)
        if (editorInfo.type === 'ace') {
            editorInfo.instance.setValue('');
            editorInfo.instance.clearSelection();
        }

        _utIsTyping = true;
        _utShouldStop = false;

        for (let i = 0; i < textToType.length; i++) {
            if (_utShouldStop || !_utIsTyping) {
                console.log('[UniversalType] Typing stopped by user');
                break;
            }

            const char = textToType[i];

            try {
                switch (editorInfo.type) {
                    case 'ace':
                        await typeCharAce(editorInfo.instance, char);
                        break;
                    case 'monaco':
                        await typeCharMonaco(editorInfo.instance, char);
                        break;
                    case 'monaco-dom':
                        await typeCharMonacoDom(editorInfo.element, char);
                        break;
                    case 'cm6':
                        await typeCharCM6(editorInfo.instance, char);
                        break;
                    case 'cm5':
                        await typeCharCM5(editorInfo.instance, char);
                        break;
                    case 'textarea':
                        await typeCharTextarea(editorInfo.element, char);
                        break;
                    case 'contenteditable':
                        await typeCharContentEditable(editorInfo.element, char);
                        break;
                    case 'execcommand':
                        await typeCharExecCommand(editorInfo.element, char);
                        break;
                }
            } catch (err) {
                console.error('[UniversalType] Error typing character:', err);
                break;
            }

            // Realistic typing delays
            const letterDelay = Math.random() * 150 + 50; // 50-200ms
            await new Promise(resolve => setTimeout(resolve, letterDelay));

            // Extra delay after spaces (end of word)
            if (char === ' ') {
                const wordDelay = Math.random() * 500 + 300; // 300-800ms
                await new Promise(resolve => setTimeout(resolve, wordDelay));
            }

            // Extra delay after sentence-ending punctuation
            if (char === '.' || char === '!' || char === '?') {
                const sentenceDelay = Math.random() * 500 + 500; // 500-1000ms
                await new Promise(resolve => setTimeout(resolve, sentenceDelay));
            }

            // Shorter delay after opening braces/brackets (code context)
            if (char === '{' || char === '(' || char === '[') {
                const braceDelay = Math.random() * 100 + 50; // 50-150ms
                await new Promise(resolve => setTimeout(resolve, braceDelay));
            }
        }

        _utIsTyping = false;
        _utShouldStop = false;
        console.log('[UniversalType] Typing complete');
    }

    // ── Entry Point ─────────────────────────────────────────────────────

    async function performUniversalType(providedText) {
        console.log('[UniversalType] Triggered');

        // If already typing, stop it
        if (_utIsTyping) {
            console.log('[UniversalType] Already typing — stopping');
            _utShouldStop = true;
            _utIsTyping = false;
            return;
        }

        // 1. Use provided text or read clipboard
        let clipText = providedText || '';
        let clipboardSource = providedText ? 'provided' : 'none';

        if (!clipText) {
            try {
                clipText = await navigator.clipboard.readText();
                clipboardSource = 'native';
                console.log('[UniversalType] Clipboard source: native, length:', clipText.length);
            } catch (err) {
                console.log('[UniversalType] Native clipboard read failed:', err.message);
            }

            if (!clipText && window.neoPassClipboard) {
                clipText = window.neoPassClipboard;
                clipboardSource = 'neoPassClipboard';
                console.log('[UniversalType] Clipboard source: neoPassClipboard, length:', clipText.length);
            }
        }

        if (!clipText) {
            console.log('[UniversalType] No clipboard content available');
            // Notify user via toast
            try {
                chrome.runtime.sendMessage({
                    action: 'showToast',
                    message: 'No clipboard content. Copy some code first.',
                    isError: true
                });
            } catch (e) { /* ignore if messaging fails */ }
            return;
        }

        // 2. Detect editor
        const editorInfo = detectEditor();

        if (!editorInfo) {
            // No editor found — copy to clipboard and show toast
            console.log('[UniversalType] No editor found — copying to clipboard as fallback');
            try {
                await navigator.clipboard.writeText(clipText);
            } catch (e) {
                console.log('[UniversalType] Clipboard write failed:', e.message);
            }
            try {
                chrome.runtime.sendMessage({
                    action: 'showToast',
                    message: 'No code editor found. Code copied to clipboard.\nClick inside an editor and try again.',
                    isError: true
                });
            } catch (e) { /* ignore */ }
            return;
        }

        // 3. Type!
        console.log('[UniversalType] Starting to type', clipText.length, 'chars into', editorInfo.type);
        await typeTextIntoEditor(editorInfo, clipText);
    }

    // ── Keyboard Listener (Backspace to stop) ───────────────────────────

    document.addEventListener('keydown', function (event) {
        if (event.key === 'Backspace' && _utIsTyping) {
            event.preventDefault();
            console.log('[UniversalType] Stopping due to Backspace');
            _utShouldStop = true;
            _utIsTyping = false;
        }
    }, true);

    // ── Keyboard Shortcut Listener ──────────────────────────────────────
    // ALT+Shift+U on Windows/Linux, Ctrl+Shift+U on Mac
    // This runs in MAIN world; chrome.commands won't fire here, so we 
    // listen for the key combo directly as a backup.

    document.addEventListener('keydown', function (event) {
        const modifierKey = window.isMac ? event.ctrlKey : event.altKey;
        if (modifierKey && event.shiftKey && event.code === 'KeyU') {
            event.preventDefault();
            event.stopPropagation();
            // If text is selected, let worker.js handle AI query
            let selectedText = window.getSelection().toString().trim();
            if (!selectedText && document.activeElement) {
                const el = document.activeElement;
                if ((el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') && el.value !== undefined) {
                    selectedText = el.value.substring(el.selectionStart, el.selectionEnd).trim();
                }
            }
            if (selectedText) return;
            // No text selected → clipboard typing
            performUniversalType();
        }
    }, true);

    // ── Expose for worker.js / chrome.scripting.executeScript ───────────
    window._neopassUniversalType = performUniversalType;

    console.log('[UniversalType] Universal Type Coding engine loaded');
})();
