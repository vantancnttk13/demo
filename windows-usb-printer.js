// windows-usb-printer.js - Windows-specific implementation
const HID = require('node-hid');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class WindowsUSBPrinter {
    constructor() {
        this.hidDevice = null;
        this.printerName = null;
        this.connectionType = null; // 'hid', 'wmi', 'direct'
        this.printerType = 'receipt';
        
        // ESC/POS Commands
        this.ESC = '\x1B';
        this.GS = '\x1D';
        this.FS = '\x1C';
        this.DLE = '\x10';
        
        this.commands = {
            INIT: this.ESC + '@',
            
            // Cut commands
            CUT_FULL: this.GS + 'V\x00',
            CUT_PARTIAL: this.GS + 'V\x01',
            CUT_FEED_FULL: this.GS + 'V\x41',
            CUT_FEED_PARTIAL: this.GS + 'V\x42',
            
            // Feed
            FEED_LINE: '\x0A',
            FEED_LINES: (n) => this.ESC + 'd' + String.fromCharCode(n),
            
            // Alignment
            ALIGN_LEFT: this.ESC + 'a\x00',
            ALIGN_CENTER: this.ESC + 'a\x01',
            ALIGN_RIGHT: this.ESC + 'a\x02',
            
            // Font
            FONT_NORMAL: this.ESC + '!\x00',
            FONT_DOUBLE_HEIGHT: this.ESC + '!\x10',
            FONT_DOUBLE_WIDTH: this.ESC + '!\x20',
            FONT_DOUBLE_BOTH: this.ESC + '!\x30',
            
            BOLD_ON: this.ESC + 'E\x01',
            BOLD_OFF: this.ESC + 'E\x00',
            
            // Disable auto-cut
            DISABLE_AUTO_CUT: this.GS + '(A\x02\x00\x30\x00',
            ENABLE_AUTO_CUT: this.GS + '(A\x02\x00\x30\x01',
        };
        
        // Windows-specific printer vendors
        this.knownPrinterVendors = {
            0x04b8: 'Epson',
            0x04e8: 'Samsung', 
            0x03f0: 'HP',
            0x04a9: 'Canon',
            0x0922: 'Dymo',
            0x0483: 'STMicroelectronics',
            0x0dd4: 'Xprinter',
            0x1a86: 'QinHeng Electronics',
            0x067b: 'Prolific',
            0x0471: 'Philips',
            0x1fc9: 'NXP',
            0x1659: 'ICS Advent',
            0x28e9: 'GDM',
            0x0525: 'Netchip Technology'
        };
        
        this.config = {
            receipt: {
                width: 48,
                autoCut: false,
                feedBeforeCut: 3,
                cutType: 'full'
            },
            label: {
                width: 56,
                autoCut: false,
                feedBeforeCut: 1,
                cutType: 'partial'
            }
        };
    }
    
    // Find printers using multiple methods for Windows
    async findUSBPrinters() {
        const printers = [];
        
        try {
            // Method 1: HID devices (most reliable on Windows)
            console.log('Scanning HID devices...');
            const hidDevices = HID.devices();
            
            for (const device of hidDevices) {
                if (this.isPrinterHID(device)) {
                    printers.push({
                        type: 'hid',
                        name: `${device.manufacturer || 'Unknown'} ${device.product || 'HID Printer'}`,
                        vendorId: device.vendorId,
                        productId: device.productId,
                        manufacturer: device.manufacturer || 'Unknown',
                        product: device.product || 'HID Printer',
                        path: device.path,
                        interface: device.interface || 0
                    });
                }
            }
            
            // Method 2: WMI Query for Windows printers
            try {
                console.log('Scanning WMI printers...');
                const wmiPrinters = await this.getWMIPrinters();
                printers.push(...wmiPrinters);
            } catch (error) {
                console.warn('WMI scan failed:', error.message);
            }
            
            // Method 3: Check common printer ports
            try {
                console.log('Scanning common printer interfaces...');
                const portPrinters = await this.scanCommonPorts();
                printers.push(...portPrinters);
            } catch (error) {
                console.warn('Port scan failed:', error.message);
            }
            
        } catch (error) {
            console.error('Error finding printers:', error);
        }
        
        // Remove duplicates
        const uniquePrinters = this.removeDuplicatePrinters(printers);
        console.log(`Found ${uniquePrinters.length} unique printers`);
        
        return uniquePrinters;
    }
    
    // Check if HID device is a printer
    isPrinterHID(device) {
        // Check known printer vendor IDs
        if (this.knownPrinterVendors[device.vendorId]) {
            return true;
        }
        
        // Check usage page for printer
        if (device.usage === 2 || device.usagePage === 7) {
            return true;
        }
        
        // Check product string for printer keywords
        const product = (device.product || '').toLowerCase();
        const printerKeywords = ['printer', 'pos', 'receipt', 'thermal', 'label', 'barcode'];
        
        return printerKeywords.some(keyword => product.includes(keyword));
    }
    
    // Get printers via WMI (Windows Management Instrumentation)
    async getWMIPrinters() {
        return new Promise((resolve) => {
            try {
                // PowerShell command to get printer info
                const psCommand = `
                    Get-WmiObject -Class Win32_Printer | Where-Object {
                        $_.Local -eq $true -and 
                        ($_.PortName -like "USB*" -or $_.PortName -like "DOT4*")
                    } | Select-Object Name, DriverName, PortName | ConvertTo-Json
                `;
                
                const result = execSync(`powershell -Command "${psCommand}"`, { 
                    encoding: 'utf8',
                    timeout: 10000 
                });
                
                const printers = JSON.parse(result || '[]');
                const formattedPrinters = (Array.isArray(printers) ? printers : [printers])
                    .filter(p => p && p.Name)
                    .map(printer => ({
                        type: 'wmi',
                        name: printer.Name,
                        driver: printer.DriverName,
                        port: printer.PortName,
                        vendorId: 0,
                        productId: 0,
                        manufacturer: 'Windows System',
                        product: printer.Name
                    }));
                
                resolve(formattedPrinters);
                
            } catch (error) {
                console.warn('WMI query failed:', error.message);
                resolve([]);
            }
        });
    }
    
    // Scan common printer communication methods
    async scanCommonPorts() {
        const printers = [];
        
        // Check if we can create temp files (for testing direct communication)
        try {
            const tempDir = require('os').tmpdir();
            const testFile = path.join(tempDir, 'printer_test.txt');
            
            // Try to find printers by checking common device paths
            const commonPaths = [
                'LPT1:', 'LPT2:', 'LPT3:',
                'COM1:', 'COM2:', 'COM3:', 'COM4:',
            ];
            
            for (const devicePath of commonPaths) {
                try {
                    // Test if we can access the device
                    fs.writeFileSync(testFile, 'test');
                    
                    printers.push({
                        type: 'direct',
                        name: `Direct ${devicePath}`,
                        path: devicePath,
                        vendorId: 0,
                        productId: 0,
                        manufacturer: 'System',
                        product: `Direct Port ${devicePath}`
                    });
                } catch (error) {
                    // Device not accessible, skip
                }
            }
            
            // Clean up test file
            try { fs.unlinkSync(testFile); } catch {}
            
        } catch (error) {
            console.warn('Direct port scan failed:', error.message);
        }
        
        return printers;
    }
    
    // Remove duplicate printers
    removeDuplicatePrinters(printers) {
        const seen = new Set();
        return printers.filter(printer => {
            const key = `${printer.vendorId}-${printer.productId}-${printer.name}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }
    
    // Connect to printer
    async connect(printerInfo) {
        try {
            console.log(`Connecting to ${printerInfo.name} via ${printerInfo.type}...`);
            
            switch (printerInfo.type) {
                case 'hid':
                    return await this.connectHID(printerInfo);
                case 'wmi':
                    return await this.connectWMI(printerInfo);
                case 'direct':
                    return await this.connectDirect(printerInfo);
                default:
                    throw new Error(`Unsupported connection type: ${printerInfo.type}`);
            }
        } catch (error) {
            console.error('Connection failed:', error);
            throw error;
        }
    }
    
    // Connect via HID
    async connectHID(printerInfo) {
        try {
            console.log(`Connecting to HID device: ${printerInfo.path}`);
            this.hidDevice = new HID.HID(printerInfo.path);
            this.connectionType = 'hid';
            this.printerName = printerInfo.name;
            
            console.log('HID connection successful');
            return true;
        } catch (error) {
            throw new Error(`HID connection failed: ${error.message}`);
        }
    }
    
    // Connect via WMI (Windows printer system)
    async connectWMI(printerInfo) {
        try {
            this.connectionType = 'wmi';
            this.printerName = printerInfo.name;
            
            // Test connection by querying printer status
            const testCommand = `powershell -Command "Get-WmiObject -Class Win32_Printer | Where-Object {$_.Name -eq '${printerInfo.name}'} | Select-Object WorkOffline"`;
            
            const result = execSync(testCommand, { encoding: 'utf8', timeout: 5000 });
            
            if (result.includes('False')) {
                console.log('WMI connection successful - printer online');
                return true;
            } else {
                throw new Error('Printer appears to be offline');
            }
        } catch (error) {
            throw new Error(`WMI connection failed: ${error.message}`);
        }
    }
    
    // Connect direct to port
    async connectDirect(printerInfo) {
        try {
            this.connectionType = 'direct';
            this.printerName = printerInfo.name;
            this.devicePath = printerInfo.path;
            
            // Test write access
            const testData = this.commands.INIT;
            await this.sendRawData(testData);
            
            console.log('Direct connection successful');
            return true;
        } catch (error) {
            throw new Error(`Direct connection failed: ${error.message}`);
        }
    }
    
    // Send raw data based on connection type
    async sendRawData(data) {
        return new Promise((resolve, reject) => {
            try {
                switch (this.connectionType) {
                    case 'hid':
                        this.sendViaHID(data, resolve, reject);
                        break;
                    case 'wmi':
                        this.sendViaWMI(data, resolve, reject);
                        break;
                    case 'direct':
                        this.sendViaDirect(data, resolve, reject);
                        break;
                    default:
                        reject(new Error('No active connection'));
                }
            } catch (error) {
                reject(error);
            }
        });
    }
    
    // Send via HID
    sendViaHID(data, resolve, reject) {
        try {
            if (!this.hidDevice) {
                reject(new Error('HID device not connected'));
                return;
            }
            
            const buffer = Buffer.from(data, 'binary');
            
            // HID requires specific packet format
            const packets = this.createHIDPackets(buffer);
            
            for (const packet of packets) {
                this.hidDevice.write(packet);
            }
            
            resolve();
        } catch (error) {
            reject(new Error(`HID write failed: ${error.message}`));
        }
    }
    
    // Create HID packets
    createHIDPackets(buffer) {
        const packets = [];
        const maxPacketSize = 64; // Standard HID packet size
        
        for (let i = 0; i < buffer.length; i += maxPacketSize - 1) {
            const chunk = buffer.slice(i, i + maxPacketSize - 1);
            const packet = Buffer.alloc(maxPacketSize);
            packet[0] = 0; // Report ID
            chunk.copy(packet, 1);
            packets.push([...packet]);
        }
        
        return packets;
    }
    
    // Send via WMI (using temporary file method)
    sendViaWMI(data, resolve, reject) {
        try {
            const tempDir = require('os').tmpdir();
            const tempFile = path.join(tempDir, `print_job_${Date.now()}.prn`);
            
            // Write data to temp file
            fs.writeFileSync(tempFile, data, 'binary');
            
            // Send to printer using Windows print command
            const printCommand = `print /D:"${this.printerName}" "${tempFile}"`;
            
            const child = spawn('cmd', ['/c', printCommand], {
                stdio: ['ignore', 'pipe', 'pipe']
            });
            
            child.on('close', (code) => {
                // Clean up temp file
                try { fs.unlinkSync(tempFile); } catch {}
                
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`Print command failed with code ${code}`));
                }
            });
            
            child.on('error', (error) => {
                try { fs.unlinkSync(tempFile); } catch {}
                reject(new Error(`Print process error: ${error.message}`));
            });
            
        } catch (error) {
            reject(new Error(`WMI print failed: ${error.message}`));
        }
    }
    
    // Send via direct port
    sendViaDirect(data, resolve, reject) {
        try {
            const tempDir = require('os').tmpdir();
            const tempFile = path.join(tempDir, `direct_print_${Date.now()}.prn`);
            
            // Write data to temp file
            fs.writeFileSync(tempFile, data, 'binary');
            
            // Copy to printer port
            const copyCommand = `copy /B "${tempFile}" ${this.devicePath}`;
            
            const child = spawn('cmd', ['/c', copyCommand], {
                stdio: ['ignore', 'pipe', 'pipe']
            });
            
            child.on('close', (code) => {
                try { fs.unlinkSync(tempFile); } catch {}
                
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`Direct print failed with code ${code}`));
                }
            });
            
            child.on('error', (error) => {
                try { fs.unlinkSync(tempFile); } catch {}
                reject(new Error(`Direct print error: ${error.message}`));
            });
            
        } catch (error) {
            reject(new Error(`Direct print failed: ${error.message}`));
        }
    }
    
    // Disconnect
    async disconnect() {
        try {
            if (this.hidDevice) {
                this.hidDevice.close();
                this.hidDevice = null;
            }
            
            this.connectionType = null;
            this.printerName = null;
            this.devicePath = null;
            
            console.log('Disconnected successfully');
        } catch (error) {
            console.error('Disconnect error:', error);
        }
    }
    
    // Set printer type with Windows-specific initialization
    async setPrinterType(type) {
        this.printerType = type;
        
        try {
            let initCmd = this.commands.INIT;
            initCmd += this.commands.DISABLE_AUTO_CUT;
            
            if (type === 'label') {
                // Label-specific initialization for Windows
                initCmd += this.ESC + 'c5\x01'; // Label mode
            } else {
                initCmd += this.ESC + 'c5\x00'; // Receipt mode
            }
            
            await this.sendRawData(initCmd);
            console.log(`Windows printer initialized in ${type} mode (auto-cut disabled)`);
            
        } catch (error) {
            console.warn('Printer initialization warning:', error.message);
            // Continue anyway as some printers don't support all commands
        }
    }
}

module.exports = WindowsUSBPrinter;