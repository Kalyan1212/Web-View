import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import fetch from 'node-fetch'; // Use node-fetch to make API requests

// Global variables for log tracking
let panel: vscode.WebviewPanel | undefined;
let lastFileSize = 0; // Track the size of the log file for incremental reading
let apiChoice: string;
let apiKey: string;
let fileWatcher: fs.FSWatcher | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('Extension activated'); // Log activation

    // Register the command in package.json
    let logReaderDisposable = vscode.commands.registerCommand('extension.startLogReader', async () => {
        console.log('Command executed: extension.startLogReader'); // Log command execution

        // Ask the user to choose between OpenAI or Gemini API
        apiChoice = await vscode.window.showQuickPick(['Gemini'], {
            placeHolder: 'Select which API to use for suggestions',
        }) || '';

        if (!apiChoice) {
            vscode.window.showErrorMessage("No API selected. Please choose Gemini.");
            return;
        }

        // Ask the user to enter the API key
        apiKey = await vscode.window.showInputBox({
            placeHolder: `Enter your ${apiChoice} API key`,
            ignoreFocusOut: true,
        }) || '';

        if (!apiKey) {
            vscode.window.showErrorMessage("No API key provided. Please enter a valid API key.");
            return;
        }

        // Ensure the log file exists
        const logFilePath = vscode.workspace.workspaceFolders
            ? path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'logs.txt')
            : null;

        if (!logFilePath) {
            vscode.window.showErrorMessage("Log file path not found. Please open a workspace.");
            return;
        }

        console.log(`Watching log file at: ${logFilePath}`); // Log file path

        // Watch the log file for changes
        fileWatcher = fs.watch(logFilePath, async (eventType) => {
            if (eventType === 'change') {
                console.log('Log file changed'); // Log file change
                const newLogs = await readNewLogEntries(logFilePath);
                const suggestions = await getSuggestionsFromGemini(newLogs);

                // Display the suggestions in a WebView
                if (!panel) {
                    panel = vscode.window.createWebviewPanel(
                        'aiSuggestions',
                        'AI Suggestions',
                        vscode.ViewColumn.One,
                        { enableScripts: true }
                    );
                }
                panel.webview.html = getWebviewContent(suggestions);
            }
        });

        vscode.window.showInformationMessage(`Watching logs.txt for changes, using ${apiChoice} API...`);
    });

    context.subscriptions.push(logReaderDisposable);
}

async function readNewLogEntries(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        fs.stat(filePath, (err, stats) => {
            if (err) {
                return reject(err);
            }

            const newFileSize = stats.size;
            if (newFileSize > lastFileSize) {
                const stream = fs.createReadStream(filePath, {
                    start: lastFileSize,
                    end: newFileSize,
                });

                let newLogs = '';
                stream.on('data', (chunk) => {
                    newLogs += chunk.toString();
                });

                stream.on('end', () => {
                    lastFileSize = newFileSize; // Update last file size after reading
                    resolve(newLogs);
                });

                stream.on('error', (err) => {
                    reject(err);
                });
            } else {
                resolve(''); // No new logs
            }
        });
    });
}

async function getSuggestionsFromGemini(logs: string): Promise<string> {
    console.log('Fetching suggestions from Gemini API'); // Log API call start
    try {
        const response = await fetch('https://api.gemini.com/v1/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                logs: logs,
                max_tokens: 100,
            }),
        });

        const data = await response.json();
        console.log('Gemini Response:', data); // Log API response

        if (data && data.suggestions && data.suggestions.length > 0) {
            return data.suggestions[0].trim();
        } else {
            throw new Error('Unexpected API response format from Gemini');
        }
    } catch (error) {
        console.error('Error fetching suggestions from Gemini:', error); // Log error
        return 'Error fetching suggestions from Gemini.';
    }
}

// Create WebView content
function getWebviewContent(suggestions: string): string {
    return `
        <html>
        <body>
            <h2>AI Suggestions</h2>
            <pre>${suggestions}</pre>
        </body>
        </html>
    `;
}

export function deactivate() {
    console.log('Extension deactivated'); // Log deactivation

    // Clean up file watcher
    if (fileWatcher) {
        fileWatcher.close();
        console.log('File watcher closed');
    }

    // Clean up webview panel
    if (panel) {
        panel.dispose();
        console.log('Webview panel disposed');
    }
}