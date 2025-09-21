// modern-print-functions.js - Print functions với control cắt giấy
const ModernUSBPOSPrinter = require('./modern-usb-printer');

class ModernPOSPrinterWithControls extends ModernUSBPOSPrinter {
    constructor() {
        super();
    }
    
    // Format text theo width
    formatText(text, alignment = 'left') {
        const config = this.config[this.printerType];
        const maxWidth = config.width;
        
        if (text.length <= maxWidth) {
            switch (alignment) {
                case 'center':
                    const padding = Math.floor((maxWidth - text.length) / 2);
                    return ' '.repeat(padding) + text;
                case 'right':
                    return ' '.repeat(maxWidth - text.length) + text;
                default:
                    return text.padEnd(maxWidth);
            }
        }
        
        // Chia thành nhiều dòng
        const lines = [];
        for (let i = 0; i < text.length; i += maxWidth) {
            lines.push(text.substr(i, maxWidth));
        }
        return lines.join('\n');
    }
    
    // In text với full control
    async printText(text, options = {}) {
        const {
            alignment = 'left',
            fontSize = 'normal',
            bold = false,
            underline = false,
            newLine = true
        } = options;
        
        let command = '';
        
        // Alignment
        switch (alignment) {
            case 'center': command += this.commands.ALIGN_CENTER; break;
            case 'right': command += this.commands.ALIGN_RIGHT; break;
            default: command += this.commands.ALIGN_LEFT;
        }
        
        // Font size
        switch (fontSize) {
            case 'double-height': command += this.commands.FONT_DOUBLE_HEIGHT; break;
            case 'double-width': command += this.commands.FONT_DOUBLE_WIDTH; break;
            case 'double': command += this.commands.FONT_DOUBLE_BOTH; break;
            default: command += this.commands.FONT_NORMAL;
        }
        
        // Style
        command += bold ? this.commands.BOLD_ON : this.commands.BOLD_OFF;
        command += underline ? this.commands.UNDERLINE_ON : this.commands.UNDERLINE_OFF;
        
        // Text
        command += this.formatText(text, alignment);
        
        if (newLine) {
            command += this.commands.FEED_LINE;
        }
        
        await this.sendRawData(command);
    }
    
    // Feed paper với control
    async feedPaper(lines = 1) {
        if (lines === 1) {
            await this.sendRawData(this.commands.FEED_LINE);
        } else if (lines > 1 && lines <= 255) {
            await this.sendRawData(this.commands.FEED_LINES(lines));
        } else {
            // Feed nhiều lần nếu > 255
            const fullFeeds = Math.floor(lines / 255);
            const remainingLines = lines % 255;
            
            for (let i = 0; i < fullFeeds; i++) {
                await this.sendRawData(this.commands.FEED_LINES(255));
            }
            
            if (remainingLines > 0) {
                await this.sendRawData(this.commands.FEED_LINES(remainingLines));
            }
        }
    }
    
    // Cut paper với full control - Giải quyết issue auto-cut
    async cutPaper(options = {}) {
        const {
            type = null,
            feedBefore = null,
            feedAfter = null
        } = options;
        
        const config = this.config[this.printerType];
        const cutType = type || config.cutType;
        const feedBeforeLines = feedBefore !== null ? feedBefore : config.feedBeforeCut;
        const feedAfterLines = feedAfter !== null ? feedAfter : config.feedAfterCut;
        
        try {
            // Feed trước khi cắt
            if (feedBeforeLines > 0) {
                await this.feedPaper(feedBeforeLines);
            }
            
            // Thực hiện cắt
            switch (cutType) {
                case 'full':
                    await this.sendRawData(this.commands.CUT_FULL);
                    console.log('Full cut executed');
                    break;
                case 'partial':
                    await this.sendRawData(this.commands.CUT_PARTIAL);
                    console.log('Partial cut executed');
                    break;
                case 'feed-full':
                    await this.sendRawData(this.commands.CUT_FEED_FULL);
                    console.log('Feed and full cut executed');
                    break;
                case 'feed-partial':
                    await this.sendRawData(this.commands.CUT_FEED_PARTIAL);
                    console.log('Feed and partial cut executed');
                    break;
                case 'none':
                default:
                    console.log('No cut performed');
                    break;
            }
            
            // Feed sau khi cắt
            if (feedAfterLines > 0) {
                await this.feedPaper(feedAfterLines);
            }
            
        } catch (error) {
            console.error('Cut operation failed:', error);
            throw error;
        }
    }
    
    // In QR Code
    async printQRCode(data, options = {}) {
        const { size = 3, errorCorrection = '1' } = options;
        
        const commands = [
            // Set QR Code model
            this.GS + '(k\x04\x00\x31\x41\x32\x00',
            // Set size
            this.GS + '(k\x03\x00\x31\x43' + String.fromCharCode(size),
            // Set error correction
            this.GS + '(k\x03\x00\x31\x45' + errorCorrection,
            // Store data
            this.GS + '(k' + String.fromCharCode((data.length + 3) & 0xFF, ((data.length + 3) >> 8) & 0xFF) + '\x31\x50\x30' + data,
            // Print
            this.GS + '(k\x03\x00\x31\x51\x30'
        ];
        
        for (const cmd of commands) {
            await this.sendRawData(cmd);
            await new Promise(resolve => setTimeout(resolve, 100)); // Delay between commands
        }
    }
    
    // In barcode
    async printBarcode(data, type = 'CODE128', options = {}) {
        const { height = 162, width = 2, hri = '2' } = options; // hri: 0=no, 1=above, 2=below, 3=both
        
        const barcodeTypes = {
            'CODE128': 73,
            'CODE39': 69,
            'EAN13': 67,
            'EAN8': 68
        };
        
        const typeCode = barcodeTypes[type] || 73;
        
        // Set barcode parameters
        await this.sendRawData(this.GS + 'h' + String.fromCharCode(height)); // Height
        await this.sendRawData(this.GS + 'w' + String.fromCharCode(width)); // Width
        await this.sendRawData(this.GS + 'H' + hri); // HRI position
        
        // Print barcode
        await this.sendRawData(this.GS + 'k' + String.fromCharCode(typeCode, data.length) + data);
    }
    
    // In receipt với NO auto-cut - Full control
    async printReceipt(receiptData, options = {}) {
        const { 
            autoCut = false, 
            cutType = 'full',
            feedBeforeCut = 3,
            feedAfterCut = 0
        } = options;
        
        try {
            // Set receipt mode và disable auto-cut
            await this.setPrinterType('receipt');
            
            const { header, items, footer, total, qrCode, barcode } = receiptData;
            
            // Header
            if (header) {
                if (header.title) {
                    await this.printText(header.title, { 
                        alignment: 'center', 
                        fontSize: 'double', 
                        bold: true 
                    });
                }
                if (header.address) {
                    await this.printText(header.address, { alignment: 'center' });
                }
                if (header.phone) {
                    await this.printText(`Tel: ${header.phone}`, { alignment: 'center' });
                }
                if (header.date) {
                    await this.printText(`Date: ${header.date}`, { alignment: 'center' });
                }
                await this.printText('='.repeat(this.config.receipt.width), { alignment: 'center' });
            }
            
            // Items
            if (items && items.length > 0) {
                for (const item of items) {
                    await this.printText(item.name, { bold: true });
                    const itemLine = `  ${item.quantity || 1} x ${item.price} = ${item.total}`;
                    await this.printText(itemLine, { alignment: 'right' });
                }
                await this.printText('-'.repeat(this.config.receipt.width));
            }
            
            // Total
            if (total) {
                await this.printText(`TOTAL: ${total}`, { 
                    alignment: 'right', 
                    fontSize: 'double-height', 
                    bold: true 
                });
                await this.printText('='.repeat(this.config.receipt.width));
            }
            
            // QR Code
            if (qrCode) {
                await this.feedPaper(1);
                await this.printQRCode(qrCode.data, qrCode.options);
                await this.feedPaper(1);
            }
            
            // Barcode
            if (barcode) {
                await this.feedPaper(1);
                await this.printBarcode(barcode.data, barcode.type, barcode.options);
                await this.feedPaper(1);
            }
            
            // Footer
            if (footer) {
                await this.printText(footer, { alignment: 'center' });
            }
            
            // Manual cut control
            if (autoCut) {
                await this.cutPaper({ 
                    type: cutType,
                    feedBefore: feedBeforeCut,
                    feedAfter: feedAfterCut
                });
            } else {
                // Chỉ feed mà không cắt
                await this.feedPaper(feedBeforeCut);
                console.log('Receipt printed without auto-cut. Use cutPaper() to cut manually.');
            }
            
        } catch (error) {
            console.error('Error printing receipt:', error);
            throw error;
        }
    }
    
    // In label với NO auto-cut
    async printLabel(labelData, options = {}) {
        const { 
            autoCut = false, 
            cutType = 'partial',
            feedBeforeCut = 1,
            feedAfterCut = 2
        } = options;
        
        try {
            // Set label mode
            await this.setPrinterType('label');
            
            const { title, content, qrCode, barcode, border = false } = labelData;
            
            // Border top
            if (border) {
                await this.printText('*'.repeat(this.config.label.width));
            }
            
            // Title
            if (title) {
                await this.printText(title, { 
                    alignment: 'center', 
                    fontSize: 'double-width', 
                    bold: true 
                });
                await this.feedPaper(1);
            }
            
            // Content
            if (content && content.length > 0) {
                for (const line of content) {
                    await this.printText(line.text, {
                        alignment: line.alignment || 'left',
                        bold: line.bold || false,
                        fontSize: line.fontSize || 'normal'
                    });
                }
                await this.feedPaper(1);
            }
            
            // QR Code
            if (qrCode) {
                await this.printQRCode(qrCode.data, qrCode.options);
                await this.feedPaper(1);
            }
            
            // Barcode
            if (barcode) {
                await this.printBarcode(barcode.data, barcode.type, barcode.options);
                await this.feedPaper(1);
            }
            
            // Border bottom
            if (border) {
                await this.printText('*'.repeat(this.config.label.width));
            }
            
            // Label thường KHÔNG tự động cắt
            if (autoCut) {
                await this.cutPaper({ 
                    type: cutType,
                    feedBefore: feedBeforeCut,
                    feedAfter: feedAfterCut
                });
            } else {
                await this.feedPaper(feedAfterCut);
                console.log('Label printed without auto-cut. Manual cut control available.');
            }
            
        } catch (error) {
            console.error('Error printing label:', error);
            throw error;
        }
    }
    
    // Test connection và basic print
    async testPrint(testType = 'basic') {
        try {
            switch (testType) {
                case 'basic':
                    await this.setPrinterType('receipt');
                    await this.printText('=== TEST PRINT ===', { alignment: 'center', bold: true });
                    await this.printText(`Printer Type: ${this.printerType}`);
                    await this.printText(`Date: ${new Date().toLocaleString()}`);
                    await this.printText('Test completed successfully!');
                    await this.feedPaper(3);
                    console.log('Basic test print completed - No auto cut');
                    break;
                    
                case 'receipt':
                    await this.printReceipt({
                        header: {
                            title: 'TEST RECEIPT',
                            address: 'Test Address 123',
                            phone: '0123-456-789',
                            date: new Date().toLocaleString()
                        },
                        items: [
                            { name: 'Test Item 1', quantity: 2, price: '25,000', total: '50,000' },
                            { name: 'Test Item 2', quantity: 1, price: '35,000', total: '35,000' }
                        ],
                        total: '85,000 VND',
                        footer: 'Thank you for testing!'
                    }, { autoCut: false }); // Không auto cut
                    break;
                    
                case 'label':
                    await this.printLabel({
                        title: 'TEST LABEL',
                        content: [
                            { text: 'Product: Test Product', bold: true },
                            { text: 'SKU: TEST-001' },
                            { text: 'Price: 100,000 VND', alignment: 'right' }
                        ],
                        qrCode: {
                            data: 'TEST-001-PRODUCT-100000',
                            options: { size: 4 }
                        }
                    }, { autoCut: false }); // Không auto cut
                    break;
            }
        } catch (error) {
            console.error('Test print failed:', error);
            throw error;
        }
    }
}

module.exports = ModernPOSPrinterWithControls;