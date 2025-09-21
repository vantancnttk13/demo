// modern-usb-printer.js - Implementation với usb package hiện đại
const usb = require('usb');
const HID = require('node-hid');

class ModernUSBPOSPrinter {
    constructor() {
        this.device = null;
        this.interface = null;
        this.endpoint = null;
        this.printerType = 'receipt';
        this.hidDevice = null;
        
        // ESC/POS Commands
        this.ESC = '\x1B';
        this.GS = '\x1D';
        this.FS = '\x1C';
        this.DLE = '\x10';
        
        this.commands = {
            // Khởi tạo
            INIT: this.ESC + '@',
            
            // Cắt giấy - Improved commands
            CUT_FULL: this.GS + 'V\x00',
            CUT_PARTIAL: this.GS + 'V\x01',
            CUT_FEED_FULL: this.GS + 'V\x41',
            CUT_FEED_PARTIAL: this.GS + 'V\x42',
            
            // Feed controls
            FEED_LINE: '\x0A',
            FEED_LINES: (n) => this.ESC + 'd' + String.fromCharCode(n),
            FEED_AND_REVERSE: (n) => this.ESC + 'e' + String.fromCharCode(n),
            
            // Alignment
            ALIGN_LEFT: this.ESC + 'a\x00',
            ALIGN_CENTER: this.ESC + 'a\x01',
            ALIGN_RIGHT: this.ESC + 'a\x02',
            
            // Font và style
            FONT_NORMAL: this.ESC + '!\x00',
            FONT_DOUBLE_HEIGHT: this.ESC + '!\x10',
            FONT_DOUBLE_WIDTH: this.ESC + '!\x20',
            FONT_DOUBLE_BOTH: this.ESC + '!\x30',
            
            BOLD_ON: this.ESC + 'E\x01',
            BOLD_OFF: this.ESC + 'E\x00',
            
            UNDERLINE_ON: this.ESC + '-\x01',
            UNDERLINE_OFF: this.ESC + '-\x00',
            
            // Receipt vs Label mode
            RECEIPT_MODE: this.ESC + 'c5\x00',
            LABEL_MODE: this.ESC + 'c5\x01',
            
            // Paper control - giúp tránh auto-cut không mong muốn
            DISABLE_AUTO_CUT: this.GS + '(A\x02\x00\x30\x00',
            ENABLE_AUTO_CUT: this.GS + '(A\x02\x00\x30\x01',
            
            // Paper status
            PAPER_STATUS: this.DLE + '\x04\x01',
        };
        
        // Cấu hình cho từng loại printer
        this.config = {
            receipt: {
                width: 48,
                autoCut: false, // Tắt auto cut để control manual
                cutAfterPrint: true,
                feedBeforeCut: 3,
                feedAfterCut: 0,
                cutType: 'full'
            },
            label: {
                width: 56,
                autoCut: false,
                cutAfterPrint: false, // Label không cắt tự động
                feedBeforeCut: 1,
                feedAfterCut: 2,
                cutType: 'none'
            }
        };
    }
    
    // Tìm USB printers với method hiện đại
    async findUSBPrinters() {
        const printers = [];
        
        try {
            // Method 1: Sử dụng USB package
            const devices = usb.getDeviceList();
            
            for (const device of devices) {
                const desc = device.deviceDescriptor;
                
                // Kiểm tra printer class hoặc known vendor IDs
                if (this.isPrinterDevice(device)) {
                    try {
                        const info = await this.getDeviceInfo(device);
                        printers.push({
                            type: 'usb',
                            vendorId: desc.idVendor,
                            productId: desc.idProduct,
                            ...info,
                            device: device
                        });
                    } catch (error) {
                        console.warn('Could not get device info:', error.message);
                    }
                }
            }
            
            // Method 2: Sử dụng HID cho một số printer
            try {
                const hidDevices = HID.devices();
                const hidPrinters = hidDevices.filter(d => 
                    d.usage === 0x02 || // Printer usage
                    this.isKnownPrinterVendor(d.vendorId)
                );
                
                for (const hidPrinter of hidPrinters) {
                    printers.push({
                        type: 'hid',
                        vendorId: hidPrinter.vendorId,
                        productId: hidPrinter.productId,
                        manufacturer: hidPrinter.manufacturer,
                        product: hidPrinter.product,
                        path: hidPrinter.path
                    });
                }
            } catch (error) {
                console.warn('HID enumeration failed:', error.message);
            }
            
        } catch (error) {
            console.error('Error finding printers:', error);
        }
        
        return printers;
    }
    
    // Kiểm tra device có phải printer không
    isPrinterDevice(device) {
        const desc = device.deviceDescriptor;
        
        // Check class 7 (Printer)
        if (desc.bDeviceClass === 7) return true;
        
        // Check known printer vendor IDs
        const knownPrinterVendors = [
            0x04b8, // Epson
            0x04e8, // Samsung
            0x03f0, // HP
            0x04a9, // Canon
            0x0922, // Dymo
            0x0483, // Custom/Generic ESC/POS
            0x0dd4, // Xprinter
            0x1a86, // QinHeng (CH340/CH341)
        ];
        
        return knownPrinterVendors.includes(desc.idVendor);
    }
    
    // Kiểm tra known printer vendor cho HID
    isKnownPrinterVendor(vendorId) {
        const knownVendors = [0x04b8, 0x04e8, 0x03f0, 0x04a9, 0x0922, 0x0483, 0x0dd4];
        return knownVendors.includes(vendorId);
    }
    
    // Lấy thông tin device
    async getDeviceInfo(device) {
        return new Promise((resolve) => {
            try {
                device.open();
                const desc = device.deviceDescriptor;
                
                let manufacturer = '';
                let product = '';
                
                // Lấy manufacturer string
                if (desc.iManufacturer) {
                    device.getStringDescriptor(desc.iManufacturer, (err, data) => {
                        if (!err) manufacturer = data;
                        
                        // Lấy product string
                        if (desc.iProduct) {
                            device.getStringDescriptor(desc.iProduct, (err, data) => {
                                if (!err) product = data;
                                device.close();
                                resolve({ manufacturer, product });
                            });
                        } else {
                            device.close();
                            resolve({ manufacturer, product });
                        }
                    });
                } else {
                    device.close();
                    resolve({ manufacturer, product });
                }
            } catch (error) {
                try { device.close(); } catch {}
                resolve({ manufacturer: 'Unknown', product: 'USB Printer' });
            }
        });
    }
    
    // Kết nối với printer
    async connect(printerInfo) {
        try {
            if (printerInfo.type === 'hid') {
                return await this.connectHID(printerInfo);
            } else {
                return await this.connectUSB(printerInfo);
            }
        } catch (error) {
            console.error('Connection failed:', error);
            throw error;
        }
    }
    
    // Kết nối USB
    async connectUSB(printerInfo) {
        const devices = usb.getDeviceList();
        this.device = devices.find(d => 
            d.deviceDescriptor.idVendor === printerInfo.vendorId &&
            d.deviceDescriptor.idProduct === printerInfo.productId
        );
        
        if (!this.device) {
            throw new Error('Printer device not found');
        }
        
        this.device.open();
        
        // Lấy interface
        const interfaces = this.device.interfaces;
        this.interface = interfaces[0];
        
        // Detach kernel driver if active (Linux)
        if (this.interface.isKernelDriverActive()) {
            this.interface.detachKernelDriver();
        }
        
        this.interface.claim();
        
        // Tìm OUT endpoint
        const endpoints = this.interface.endpoints;
        this.endpoint = endpoints.find(ep => ep.direction === 'out');
        
        if (!this.endpoint) {
            throw new Error('No suitable endpoint found');
        }
        
        console.log('USB printer connected successfully');
        return true;
    }
    
    // Kết nối HID
    async connectHID(printerInfo) {
        this.hidDevice = new HID.HID(printerInfo.path);
        console.log('HID printer connected successfully');
        return true;
    }
    
    // Gửi data
    async sendRawData(data) {
        return new Promise((resolve, reject) => {
            try {
                if (this.hidDevice) {
                    // HID write
                    const buffer = Buffer.from(data, 'binary');
                    this.hidDevice.write([...buffer]);
                    resolve();
                } else if (this.endpoint) {
                    // USB write
                    const buffer = Buffer.from(data, 'binary');
                    this.endpoint.transfer(buffer, (error) => {
                        if (error) {
                            reject(new Error(`Transfer failed: ${error.message}`));
                        } else {
                            resolve();
                        }
                    });
                } else {
                    reject(new Error('No active connection'));
                }
            } catch (error) {
                reject(error);
            }
        });
    }
    
    // Ngắt kết nối
    async disconnect() {
        try {
            if (this.hidDevice) {
                this.hidDevice.close();
                this.hidDevice = null;
            }
            
            if (this.interface) {
                this.interface.release();
            }
            
            if (this.device) {
                this.device.close();
            }
            
            this.device = null;
            this.interface = null;
            this.endpoint = null;
            
        } catch (error) {
            console.error('Error disconnecting:', error);
        }
    }
    
    // Set printer type và disable auto-cut
    async setPrinterType(type) {
        this.printerType = type;
        
        // Initialize và disable auto cut
        let initCmd = this.commands.INIT;
        initCmd += this.commands.DISABLE_AUTO_CUT; // Quan trọng: Tắt auto cut
        
        if (type === 'label') {
            initCmd += this.commands.LABEL_MODE;
        } else {
            initCmd += this.commands.RECEIPT_MODE;
        }
        
        await this.sendRawData(initCmd);
        console.log(`Printer set to ${type} mode with auto-cut disabled`);
    }
}

module.exports = ModernUSBPOSPrinter;