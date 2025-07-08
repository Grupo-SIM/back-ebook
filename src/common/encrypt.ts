const xorKey = 'chaveSecreta';

function encryptNextPageToken(lastDate: string): string {
    const obj = { lastDate };
    const json = JSON.stringify(obj);
    
    const xorEncrypt = (input: string, key: string): string => {
        let result = '';
        for (let i = 0; i < input.length; i++) {
            result += String.fromCharCode(input.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return result;
    };

    const encrypted = xorEncrypt(json, xorKey);
    return Buffer.from(encrypted).toString('base64');
}

function decryptNextPageToken(token: string): {
  [x: string]: string; lastDate: string 
} {
    const xorDecrypt = (input: string, key: string): string => {
        let result = '';
        for (let i = 0; i < input.length; i++) {
            result += String.fromCharCode(input.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return result;
    };

    try {
        const decrypted = xorDecrypt(Buffer.from(token, 'base64').toString(), xorKey);
        console.log('Decrypted Value:', decrypted);
        return JSON.parse(decrypted);
    } catch (error) {
        console.error('Decryption error:', error);
        throw new Error('Invalid next page token');
    }
}

function encryptNextPageTokenTwo(obj: { lastCreatedAtWp?: string; lastCreatedAtRedirect?: string }): string {
    const json = JSON.stringify(obj);

    const xorEncrypt = (input: string, key: string): string => {
        let result = '';
        for (let i = 0; i < input.length; i++) {
            result += String.fromCharCode(input.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return result;
    };

    const encrypted = xorEncrypt(json, xorKey);
    return Buffer.from(encrypted).toString('base64');
}

function decryptNextPageTokenTwo(token: string): { lastCreatedAtWp?: string; lastCreatedAtRedirect?: string } {
    const xorDecrypt = (input: string, key: string): string => {
        let result = '';
        for (let i = 0; i < input.length; i++) {
            result += String.fromCharCode(input.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return result;
    };

    const decrypted = xorDecrypt(Buffer.from(token, 'base64').toString(), xorKey);
    return JSON.parse(decrypted);
}

export { encryptNextPageToken, decryptNextPageToken, decryptNextPageTokenTwo, encryptNextPageTokenTwo };