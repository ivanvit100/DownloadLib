'use strict';

(function(global) {
    console.log('[FileUtils] Loading...');

    class FileUtils {
        static async downloadBlob(blob, filename) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            
            setTimeout(() => {
                URL.revokeObjectURL(url);
                a.remove();
            }, 10000);
        }

        static async readFile(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = reject;
                reader.readAsText(file);
            });
        }

        static async readFileAsArrayBuffer(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = reject;
                reader.readAsArrayBuffer(file);
            });
        }

        static getFileExtension(filename) {
            return filename.split('.').pop().toLowerCase();
        }

        static isValidFormat(format) {
            const validFormats = ['fb2', 'epub', 'pdf'];
            return validFormats.includes(format.toLowerCase());
        }
    }

    global.FileUtils = FileUtils;
    console.log('[FileUtils] Loaded');
})(window);