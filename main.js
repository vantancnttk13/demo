// main.js - Windows-optimized version
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');

// Import Windows-specific printer class
const WindowsUSBPrinter = require('./windows-usb-printer');

let mainWindow;
let printer = new WindowsUSBPrinter();

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 900,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        icon: path.join(__dirname, 'assets', 'icon.ico') // Optional icon
    });

    mainWindow.loadFile('index.html');
    
    // Open DevTools in development
    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools();
    }
    
    // Windows-specific: Handle app ready state
    mainWindow.once('ready-to-show', () => {
        console.log('Windows Electron app ready');
        mainWindow.show();
    });
}

// Windows-specific app initialization
app.whenReady().then(() => {
    createWindow();
    
    // Windows-specific: Set app user model ID
    if (process.platform === 'win32') {
        app.setAppUserModelId('com.yourcompany.pos-printer');
    }
    
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    // Windows-specific cleanup
    printer.disconnect().finally(() => {
        app.quit();
    });
});

// Handle Windows sleep/resume
if (process.platform === 'win32') {
    app.on('suspend', () => {
        console.log('System suspend - maintaining printer connection');
    });
    
    app.on('resume', () => {
        console.log('System resume - checking printer connection');
    });
}

// ===========================================
// WINDOWS-OPTIMIZED IPC HANDLERS
// ===========================================

// Find printers - Windows version
ipcMain.handle('find-printers', async () => {
    try {
        console.log('Starting Windows printer discovery...');
        const printers = await printer.findUSBPrinters();
        
        console.log(`Windows printer scan complete: ${printers.length} found`);
        return { 
            success: true, 
            printers,
            platform: 'windows',
            message: `Found ${printers.length} printers using Windows methods`
        };
    } catch (error) {
        console.error('Windows printer discovery error:', error);
        return { 
            success: false, 
            error: error.message,
            platform: 'windows',
            suggestion: 'Try running as Administrator or check printer drivers'
        };
    }
});

// Connect printer - Windows version
ipcMain.handle('connect-printer', async (event, printerInfo) => {
    try {
        console.log(`Windows: Connecting to ${printerInfo.name} via ${printerInfo.type}`);
        
        await printer.connect(printerInfo);
        
        return { 
            success: true, 
            message: `Connected to ${printerInfo.name} via ${printerInfo.type}`,
            connectionType: printerInfo.type
        };
    } catch (error) {
        console.error('Windows connection error:', error);
        
        let suggestion = 'Check printer connection and try again';
        if (error.message.includes('Access denied') || error.message.includes('permission')) {
            suggestion = 'Try running as Administrator or check printer permissions';
        } else if (error.message.includes('offline')) {
            suggestion = 'Check if printer is powered on and not offline in Windows settings';
        } else if (error.message.includes('HID')) {
            suggestion = 'Printer may need specific Windows drivers. Try WMI method instead';
        }
        
        return { 
            success: false, 
            error: error.message,
            suggestion
        };
    }
});

// Test Windows-specific methods
ipcMain.handle('test-windows-methods', async () => {
    try {
        const results = {
            hid: false,
            wmi: false,
            direct: false,
            powershell: false
        };
        
        // Test HID
        try {
            const HID = require('node-hid');
            const devices = HID.devices();
            results.hid = true;
            console.log(`HID: Found ${devices.length} HID devices`);
        } catch (error) {
            console.warn('HID test failed:', error.message);
        }
        
        // Test PowerShell/WMI
        try {
            const { execSync } = require('child_process');
            const result = execSync('powershell -Command "Get-WmiObject -Class Win32_Printer | Measure-Object | Select-Object Count"', 
                { encoding: 'utf8', timeout: 5000 });
            results.wmi = true;
            results.powershell = true;
            console.log('WMI/PowerShell test successful');
        } catch (error) {
            console.warn('WMI/PowerShell test failed:', error.message);
        }
        
        // Test direct port access
        try {
            const fs = require('fs');
            const tempFile = require('path').join(require('os').tmpdir(), 'printer_test.tmp');
            fs.writeFileSync(tempFile, 'test');
            fs.unlinkSync(tempFile);
            results.direct = true;
            console.log('Direct file access test successful');
        } catch (error) {
            console.warn('Direct access test failed:', error.message);
        }
        
        return {
            success: true,
            results,
            platform: process.platform,
            arch: process.arch,
            nodeVersion: process.version
        };
        
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
});

// Get Windows printer status
ipcMain.handle('get-printer-status', async (event, printerName) => {
    try {
        const { execSync } = require('child_process');
        const command = `powershell -Command "Get-WmiObject -Class Win32_Printer | Where-Object {$_.Name -eq '${printerName}'} | Select-Object Name, WorkOffline, PrinterStatus, DetectedErrorState | ConvertTo-Json"`;
        
        const result = execSync(command, { encoding: 'utf8', timeout: 5000 });
        const status = JSON.parse(result);
        
        return {
            success: true,
            status: {
                name: status.Name,
                online: !status.WorkOffline,
                printerStatus: status.PrinterStatus,
                errorState: status.DetectedErrorState
            }
        };
        
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
});

// All other IPC handlers remain the same as original main.js...
// (Copy the rest from the original main.js artifact)

// Disconnect printer
ipcMain.handle('disconnect-printer', async () => {
    try {
        await printer.disconnect();
        return { success: true, message: 'Printer disconnected' };
    } catch (error) {
        console.error('Disconnect error:', error);
        return { success: false, error: error.message };
    }
});

// Set printer type
ipcMain.handle('set-printer-type', async (event, type) => {
    try {
        await printer.setPrinterType(type);
        return { success: true, message: `Printer type set to ${type}` };
    } catch (error) {
        console.error('Set printer type error:', error);
        return { success: false, error: error.message };
    }
});

// Print functions - add error handling for Windows
const handlePrintOperation = async (operation, operationName) => {
    try {
        await operation();
        return { success: true, message: `${operationName} completed successfully` };
    } catch (error) {
        console.error(`${operationName} error:`, error);
        
        let suggestion = 'Try again or check printer connection';
        if (error.message.includes('timeout')) {
            suggestion = 'Printer may be busy. Wait and try again';
        } else if (error.message.includes('offline')) {
            suggestion = 'Check printer power and Windows printer status';
        } else if (error.message.includes('access')) {
            suggestion = 'Try running as Administrator';
        }
        
        return { 
            success: false, 
            error: error.message,
            suggestion
        };
    }
};

// Test print
ipcMain.handle('test-print', async (event, testType) => {
    return await handlePrintOperation(
        () => printer.testPrint(testType),
        `Test print ${testType}`
    );
});

// Feed paper
ipcMain.handle('feed-paper', async (event, lines) => {
    return await handlePrintOperation(
        () => printer.feedPaper(lines),
        `Feed ${lines} lines`
    );
});

// Cut paper
ipcMain.handle('cut-paper', async (event, options) => {
    return await handlePrintOperation(
        () => printer.cutPaper(options),
        'Paper cut'
    );
});

// Send raw data
ipcMain.handle('send-raw', async (event, data) => {
    return await handlePrintOperation(
        () => printer.sendRawData(data),
        'Send raw data'
    );
});

// Windows-specific: Show native message
ipcMain.handle('show-native-message', async (event, title, message, type = 'info') => {
    const options = {
        type: type,
        title: title,
        message: message,
        buttons: ['OK']
    };
    
    const result = await dialog.showMessageBox(mainWindow, options);
    return result.response === 0;
});

console.log('Windows Electron POS Printer app started. Main process ready.');

// Windows-specific: Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    dialog.showErrorBox('Application Error', `An error occurred: ${error.message}`);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
});