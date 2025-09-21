// renderer.js - Electron renderer process
const { ipcRenderer } = require('electron');

// Global state
let isConnected = false;
let currentPrinter = null;
let currentMode = 'none';

// Utility functions
function log(message, type = 'info') {
    const output = document.getElementById('logOutput');
    const timestamp = new Date().toLocaleTimeString();
    const colorMap = {
        info: '#00ff00',
        error: '#ff6b6b',
        warning: '#ffeb3b',
        success: '#4caf50'
    };
    
    const color = colorMap[type] || '#00ff00';
    output.innerHTML += `<span style="color: ${color}">[${timestamp}] ${message}</span><br>`;
    output.scrollTop = output.scrollHeight;
}

function showStatus(message, type = 'info') {
    const status = document.getElementById('connectionStatus');
    status.className = `status ${type}`;
    status.textContent = message;
    status.classList.remove('hidden');
    
    log(`Status: ${message}`, type);
}

function updateUI() {
    // Connection buttons
    document.getElementById('findBtn').disabled = isConnected;
    document.getElementById('connectBtn').disabled = isConnected || !currentPrinter;
    document.getElementById('disconnectBtn').disabled = !isConnected;
    
    // Printer select
    document.getElementById('printerSelect').disabled = isConnected;
    
    // Mode buttons
    document.getElementById('receiptModeBtn').disabled = !isConnected;
    document.getElementById('labelModeBtn').disabled = !isConnected;
    
    // Test buttons
    document.getElementById('testBasicBtn').disabled = !isConnected;
    document.getElementById('testReceiptBtn').disabled = !isConnected;
    document.getElementById('testLabelBtn').disabled = !isConnected;
    
    // Manual control buttons
    document.querySelectorAll('.feed-btn, .cut-btn').forEach(btn => {
        btn.disabled = !isConnected;
    });
    
    // Print buttons
    document.querySelectorAll('.receipt-btn, .label-btn').forEach(btn => {
        btn.disabled = !isConnected;
    });
    
    // Advanced controls
    document.getElementById('printTextBtn').disabled = !isConnected;
    document.getElementById('rawBtn').disabled = !isConnected;
    
    // Update current mode display
    document.getElementById('currentMode').textContent = currentMode;
    
    // Show/hide printer info
    const printerInfo = document.getElementById('printerInfo');
    if (isConnected && currentPrinter) {
        printerInfo.classList.remove('hidden');
        document.getElementById('printerDetails').innerHTML = `
            <strong>Type:</strong> ${currentPrinter.type}<br>
            <strong>Vendor:</strong> ${currentPrinter.manufacturer || 'Unknown'}<br>
            <strong>Product:</strong> ${currentPrinter.product || 'Unknown'}<br>
            <strong>VID:PID:</strong> 0x${currentPrinter.vendorId.toString(16).padStart(4, '0')}:0x${currentPrinter.productId.toString(16).padStart(4, '0')}
        `;
    } else {
        printerInfo.classList.add('hidden');
    }
}

// Printer functions
async function findPrinters() {
    try {
        showStatus('Searching for USB printers...', 'info');
        log('Finding USB printers...', 'info');
        
        const result = await ipcRenderer.invoke('find-printers');
        
        if (result.success) {
            const select = document.getElementById('printerSelect');
            select.innerHTML = '<option value="">Select a printer...</option>';
            
            if (result.printers.length === 0) {
                showStatus('No USB printers found', 'warning');
                log('No printers found. Make sure printer is connected and powered on.', 'warning');
            } else {
                result.printers.forEach((printer, index) => {
                    const option = document.createElement('option');
                    option.value = index;
                    option.textContent = `${printer.type.toUpperCase()}: ${printer.manufacturer || 'Unknown'} - ${printer.product || 'USB Printer'} (${printer.vendorId.toString(16)}:${printer.productId.toString(16)})`;
                    select.appendChild(option);
                });
                
                showStatus(`Found ${result.printers.length} printer(s)`, 'success');
                log(`Found ${result.printers.length} printers`, 'success');
                
                // Store printers for later use
                window.foundPrinters = result.printers;
                
                // Enable printer selection
                select.disabled = false;
                select.onchange = () => {
                    const selectedIndex = select.value;
                    if (selectedIndex !== '') {
                        currentPrinter = window.foundPrinters[selectedIndex];
                        log(`Selected: ${currentPrinter.manufacturer} - ${currentPrinter.product}`, 'info');
                        updateUI();
                    } else {
                        currentPrinter = null;
                        updateUI();
                    }
                };
            }
        } else {
            showStatus(`Error: ${result.error}`, 'error');
        }
    } catch (error) {
        showStatus(`Find error: ${error.message}`, 'error');
        log(`Find printers failed: ${error.message}`, 'error');
    }
    
    updateUI();
}

async function connectPrinter() {
    if (!currentPrinter) {
        showStatus('Please select a printer first', 'error');
        return;
    }
    
    try {
        showStatus('Connecting to printer...', 'info');
        log(`Connecting to ${currentPrinter.product}...`, 'info');
        
        const result = await ipcRenderer.invoke('connect-printer', currentPrinter);
        
        if (result.success) {
            isConnected = true;
            showStatus('Printer connected successfully!', 'success');
            log('Printer connected successfully', 'success');
        } else {
            showStatus(`Connection failed: ${result.error}`, 'error');
        }
    } catch (error) {
        showStatus(`Connection error: ${error.message}`, 'error');
        log(`Connection failed: ${error.message}`, 'error');
    }
    
    updateUI();
}

async function disconnectPrinter() {
    try {
        showStatus('Disconnecting...', 'info');
        log('Disconnecting printer...', 'info');
        
        const result = await ipcRenderer.invoke('disconnect-printer');
        
        if (result.success) {
            isConnected = false;
            currentMode = 'none';
            showStatus('Printer disconnected', 'info');
            log('Printer disconnected', 'info');
        } else {
            showStatus(`Disconnect error: ${result.error}`, 'error');
        }
    } catch (error) {
        showStatus(`Disconnect error: ${error.message}`, 'error');
        log(`Disconnect failed: ${error.message}`, 'error');
    }
    
    updateUI();
}

async function setPrinterType(type) {
    try {
        log(`Setting printer mode to ${type}...`, 'info');
        
        const result = await ipcRenderer.invoke('set-printer-type', type);
        
        if (result.success) {
            currentMode = type;
            log(`Printer mode set to ${type} (auto-cut disabled)`, 'success');
            showStatus(`Mode: ${type} - Auto-cut disabled for manual control`, 'success');
        } else {
            log(`Failed to set mode: ${result.error}`, 'error');
            showStatus(`Mode change failed: ${result.error}`, 'error');
        }
    } catch (error) {
        log(`Set mode error: ${error.message}`, 'error');
        showStatus(`Mode error: ${error.message}`, 'error');
    }
    
    updateUI();
}

async function testPrint(testType) {
    try {
        log(`Running ${testType} test...`, 'info');
        showStatus(`Printing ${testType} test...`, 'info');
        
        const result = await ipcRenderer.invoke('test-print', testType);
        
        if (result.success) {
            log(`${testType} test completed successfully (no auto-cut)`, 'success');
            showStatus(`${testType} test printed - Use manual cut controls if needed`, 'success');
        } else {
            log(`Test print failed: ${result.error}`, 'error');
            showStatus(`Test failed: ${result.error}`, 'error');
        }
    } catch (error) {
        log(`Test print error: ${error.message}`, 'error');
        showStatus(`Test error: ${error.message}`, 'error');
    }
}

async function feedPaper(lines) {
    try {
        log(`Feeding ${lines} lines...`, 'info');
        
        const result = await ipcRenderer.invoke('feed-paper', lines);
        
        if (result.success) {
            log(`Fed ${lines} lines successfully`, 'success');
        } else {
            log(`Feed failed: ${result.error}`, 'error');
        }
    } catch (error) {
        log(`Feed error: ${error.message}`, 'error');
    }
}

async function cutPaper(cutType) {
    try {
        log(`Executing ${cutType} cut...`, 'warning');
        
        const result = await ipcRenderer.invoke('cut-paper', { type: cutType });
        
        if (result.success) {
            log(`${cutType} cut completed`, 'success');
            showStatus(`Paper cut completed (${cutType})`, 'success');
        } else {
            log(`Cut failed: ${result.error}`, 'error');
            showStatus(`Cut failed: ${result.error}`, 'error');
        }
    } catch (error) {
        log(`Cut error: ${error.message}`, 'error');
        showStatus(`Cut error: ${error.message}`, 'error');
    }
}

async function printCustomReceipt(autoCut = false) {
    try {
        const receiptDataText = document.getElementById('receiptData').value;
        const receiptData = JSON.parse(receiptDataText);
        
        log(`Printing custom receipt (auto-cut: ${autoCut})...`, 'info');
        showStatus('Printing custom receipt...', 'info');
        
        const result = await ipcRenderer.invoke('print-receipt', receiptData, { 
            autoCut: autoCut,
            cutType: 'full',
            feedBeforeCut: 3,
            feedAfterCut: 1
        });
        
        if (result.success) {
            log(`Receipt printed successfully ${autoCut ? 'with auto-cut' : '(no auto-cut)'}`, 'success');
            showStatus(`Receipt printed ${autoCut ? 'and cut' : '- use cut button if needed'}`, 'success');
        } else {
            log(`Print failed: ${result.error}`, 'error');
            showStatus(`Print failed: ${result.error}`, 'error');
        }
    } catch (error) {
        if (error instanceof SyntaxError) {
            log('Invalid JSON format in receipt data', 'error');
            showStatus('Invalid JSON format', 'error');
        } else {
            log(`Print receipt error: ${error.message}`, 'error');
            showStatus(`Print error: ${error.message}`, 'error');
        }
    }
}

async function printCustomLabel(autoCut = false) {
    try {
        const labelDataText = document.getElementById('labelData').value;
        const labelData = JSON.parse(labelDataText);
        
        log(`Printing custom label (auto-cut: ${autoCut})...`, 'info');
        showStatus('Printing custom label...', 'info');
        
        const result = await ipcRenderer.invoke('print-label', labelData, { 
            autoCut: autoCut,
            cutType: 'partial', // Labels usually use partial cut
            feedBeforeCut: 1,
            feedAfterCut: 2
        });
        
        if (result.success) {
            log(`Label printed successfully ${autoCut ? 'with auto-cut' : '(no auto-cut)'}`, 'success');
            showStatus(`Label printed ${autoCut ? 'and cut' : '- use cut button if needed'}`, 'success');
        } else {
            log(`Print failed: ${result.error}`, 'error');
            showStatus(`Print failed: ${result.error}`, 'error');
        }
    } catch (error) {
        if (error instanceof SyntaxError) {
            log('Invalid JSON format in label data', 'error');
            showStatus('Invalid JSON format', 'error');
        } else {
            log(`Print label error: ${error.message}`, 'error');
            showStatus(`Print error: ${error.message}`, 'error');
        }
    }
}

async function printCustomText() {
    try {
        const text = document.getElementById('customText').value;
        const alignment = document.getElementById('textAlignment').value;
        const fontSize = document.getElementById('textSize').value;
        const bold = document.getElementById('textBold').checked;
        
        if (!text) {
            showStatus('Please enter text to print', 'warning');
            return;
        }
        
        log(`Printing custom text: "${text}"`, 'info');
        
        const result = await ipcRenderer.invoke('print-text', text, {
            alignment,
            fontSize,
            bold,
            newLine: true
        });
        
        if (result.success) {
            log('Custom text printed successfully', 'success');
        } else {
            log(`Print text failed: ${result.error}`, 'error');
        }
    } catch (error) {
        log(`Print text error: ${error.message}`, 'error');
    }
}

async function sendRawCommand() {
    try {
        const command = document.getElementById('rawCommand').value;
        
        if (!command) {
            showStatus('Please enter a raw command', 'warning');
            return;
        }
        
        // Process escape sequences
        const processedCommand = command.replace(/\\x([0-9A-Fa-f]{2})/g, (match, hex) => {
            return String.fromCharCode(parseInt(hex, 16));
        });
        
        log(`Sending raw command: ${command}`, 'info');
        
        const result = await ipcRenderer.invoke('send-raw', processedCommand);
        
        if (result.success) {
            log('Raw command sent successfully', 'success');
        } else {
            log(`Raw command failed: ${result.error}`, 'error');
        }
    } catch (error) {
        log(`Raw command error: ${error.message}`, 'error');
    }
}

function clearLog() {
    document.getElementById('logOutput').innerHTML = '=== Log Cleared ===<br>';
}

// Advanced print functions
async function printQRCode() {
    const data = prompt('Enter QR code data:', 'https://example.com');
    if (!data) return;
    
    try {
        log(`Printing QR code: ${data}`, 'info');
        
        const result = await ipcRenderer.invoke('print-qr', data, { size: 4 });
        
        if (result.success) {
            log('QR code printed successfully', 'success');
        } else {
            log(`QR print failed: ${result.error}`, 'error');
        }
    } catch (error) {
        log(`QR code error: ${error.message}`, 'error');
    }
}

async function printBarcode() {
    const data = prompt('Enter barcode data:', '1234567890');
    if (!data) return;
    
    try {
        log(`Printing barcode: ${data}`, 'info');
        
        const result = await ipcRenderer.invoke('print-barcode', data, 'CODE128', {
            height: 162,
            width: 2,
            hri: '2'
        });
        
        if (result.success) {
            log('Barcode printed successfully', 'success');
        } else {
            log(`Barcode print failed: ${result.error}`, 'error');
        }
    } catch (error) {
        log(`Barcode error: ${error.message}`, 'error');
    }
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
            case 'f':
                e.preventDefault();
                if (!isConnected) findPrinters();
                break;
            case 'c':
                e.preventDefault();
                if (!isConnected && currentPrinter) connectPrinter();
                break;
            case 'd':
                e.preventDefault();
                if (isConnected) disconnectPrinter();
                break;
            case '1':
                e.preventDefault();
                if (isConnected) feedPaper(1);
                break;
            case '5':
                e.preventDefault();
                if (isConnected) feedPaper(5);
                break;
        }
    }
});

// Initialize UI
updateUI();
log('Renderer process loaded. Ready to use!', 'success');

// Add some helper text to log
setTimeout(() => {
    log('=== INSTRUCTIONS ===', 'info');
    log('1. Click "Find USB Printers" to discover connected printers', 'info');
    log('2. Select a printer from dropdown and click "Connect"', 'info');
    log('3. Set printer mode (Receipt/Label) - this disables auto-cut', 'info');
    log('4. Use test prints to verify functionality', 'info');
    log('5. Use manual cut controls after printing', 'info');
    log('', 'info');
    log('Keyboard shortcuts:', 'info');
    log('Ctrl+F: Find printers | Ctrl+C: Connect | Ctrl+D: Disconnect', 'info');
    log('Ctrl+1: Feed 1 line | Ctrl+5: Feed 5 lines', 'info');
    log('=== Ready to start ===', 'success');
}, 1000);