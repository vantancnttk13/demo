// main.js - Electron main process
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');

// Import printer class
const ModernPOSPrinterWithControls = require('./modern-print-functions');

let mainWindow;
let printer = new ModernPOSPrinterWithControls();

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 900,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.loadFile('index.html');
    
    // Open DevTools in development
    // if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools();
    // }
}

app.whenReady().then(() => {
    createWindow();
    
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        // Đảm bảo disconnect printer trước khi quit
        printer.disconnect();
        app.quit();
    }
});

// ===========================================
// IPC HANDLERS CHO PRINTER OPERATIONS
// ===========================================

// Tìm printers
ipcMain.handle('find-printers', async () => {
    try {
        const printers = await printer.findUSBPrinters();
        console.log('Found printers:', printers.length);
        return { success: true, printers };
    } catch (error) {
        console.error('Find printers error:', error);
        return { success: false, error: error.message };
    }
});

// Connect printer
ipcMain.handle('connect-printer', async (event, printerInfo) => {
    try {
        await printer.connect(printerInfo);
        return { success: true, message: 'Printer connected successfully' };
    } catch (error) {
        console.error('Connect error:', error);
        return { success: false, error: error.message };
    }
});

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

// Test print
ipcMain.handle('test-print', async (event, testType) => {
    try {
        await printer.testPrint(testType);
        return { success: true, message: `Test print ${testType} completed` };
    } catch (error) {
        console.error('Test print error:', error);
        return { success: false, error: error.message };
    }
});

// Print text
ipcMain.handle('print-text', async (event, text, options) => {
    try {
        await printer.printText(text, options);
        return { success: true };
    } catch (error) {
        console.error('Print text error:', error);
        return { success: false, error: error.message };
    }
});

// Feed paper
ipcMain.handle('feed-paper', async (event, lines) => {
    try {
        await printer.feedPaper(lines);
        return { success: true, message: `Fed ${lines} lines` };
    } catch (error) {
        console.error('Feed paper error:', error);
        return { success: false, error: error.message };
    }
});

// Cut paper
ipcMain.handle('cut-paper', async (event, options) => {
    try {
        await printer.cutPaper(options);
        return { success: true, message: 'Paper cut completed' };
    } catch (error) {
        console.error('Cut paper error:', error);
        return { success: false, error: error.message };
    }
});

// Print receipt
ipcMain.handle('print-receipt', async (event, receiptData, options) => {
    try {
        await printer.printReceipt(receiptData, options);
        return { success: true, message: 'Receipt printed successfully' };
    } catch (error) {
        console.error('Print receipt error:', error);
        return { success: false, error: error.message };
    }
});

// Print label
ipcMain.handle('print-label', async (event, labelData, options) => {
    try {
        await printer.printLabel(labelData, options);
        return { success: true, message: 'Label printed successfully' };
    } catch (error) {
        console.error('Print label error:', error);
        return { success: false, error: error.message };
    }
});

// Print QR Code
ipcMain.handle('print-qr', async (event, data, options) => {
    try {
        await printer.printQRCode(data, options);
        return { success: true, message: 'QR code printed' };
    } catch (error) {
        console.error('Print QR error:', error);
        return { success: false, error: error.message };
    }
});

// Print Barcode
ipcMain.handle('print-barcode', async (event, data, type, options) => {
    try {
        await printer.printBarcode(data, type, options);
        return { success: true, message: 'Barcode printed' };
    } catch (error) {
        console.error('Print barcode error:', error);
        return { success: false, error: error.message };
    }
});

// Send raw data
ipcMain.handle('send-raw', async (event, data) => {
    try {
        await printer.sendRawData(data);
        return { success: true, message: 'Raw data sent' };
    } catch (error) {
        console.error('Send raw error:', error);
        return { success: false, error: error.message };
    }
});

console.log('Electron app started. Main process ready.');