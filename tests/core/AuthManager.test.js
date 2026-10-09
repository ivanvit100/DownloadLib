import { describe, it, expect, beforeEach, vi } from 'vitest';

let AuthManager;
let mockRuntime;
let mockScripting;

beforeEach(async () => {
    vi.resetModules();

    mockRuntime = { sendMessage: vi.fn() };
    mockScripting = { executeScript: vi.fn() };

    global.browser = { runtime: mockRuntime, scripting: mockScripting };

    ({ AuthManager } = await import('../../core/AuthManager.js'));
});

describe('AuthManager.getToken', () => {
    it('returns cached token from sendMessage', async () => {
        mockRuntime.sendMessage.mockResolvedValue({ token: 'jwt-abc' });
        const token = await AuthManager.getToken('mangalib');
        expect(token).toBe('jwt-abc');
        expect(mockRuntime.sendMessage).toHaveBeenCalledWith({ action: 'getAuthToken', serviceKey: 'mangalib' });
    });

    it('returns null when cached token is absent and no tabId', async () => {
        mockRuntime.sendMessage.mockResolvedValue({ token: null });
        const token = await AuthManager.getToken('mangalib');
        expect(token).toBeNull();
    });

    it('returns null when sendMessage throws and no tabId', async () => {
        mockRuntime.sendMessage.mockRejectedValue(new Error('no background'));
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const token = await AuthManager.getToken('mangalib');
        expect(token).toBeNull();
        expect(warnSpy).toHaveBeenCalledWith('[AuthManager] Failed to get cached auth token:', expect.any(Error));
        warnSpy.mockRestore();
    });

    it('extracts token via executeScript when tabId is provided', async () => {
        mockRuntime.sendMessage
            .mockResolvedValueOnce({ token: null })
            .mockResolvedValue({ ok: true });
        mockScripting.executeScript.mockResolvedValue([{ result: 'extracted-jwt' }]);

        const token = await AuthManager.getToken('mangalib', 7);
        expect(token).toBe('extracted-jwt');
        expect(mockScripting.executeScript).toHaveBeenCalledWith(
            expect.objectContaining({ target: { tabId: 7 } })
        );
        expect(mockRuntime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'cacheAuthToken', token: 'extracted-jwt' })
        );
    });

    it('returns null when executeScript returns empty result', async () => {
        mockRuntime.sendMessage.mockResolvedValue({ token: null });
        mockScripting.executeScript.mockResolvedValue([{ result: null }]);
        const token = await AuthManager.getToken('ranobelib', 3);
        expect(token).toBeNull();
    });

    it('returns null and warns when executeScript throws', async () => {
        mockRuntime.sendMessage.mockResolvedValue({ token: null });
        mockScripting.executeScript.mockRejectedValue(new Error('script fail'));
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const token = await AuthManager.getToken('mangalib', 5);
        expect(token).toBeNull();
        expect(warnSpy).toHaveBeenCalledWith(
            '[AuthManager] Failed to extract auth token via executeScript:', expect.any(Error)
        );
        warnSpy.mockRestore();
    });

    it('skips executeScript when scripting API is absent', async () => {
        vi.resetModules();
        global.browser = { runtime: { sendMessage: vi.fn().mockResolvedValue({ token: null }) } };
        const { AuthManager: AM } = await import('../../core/AuthManager.js');
        const token = await AM.getToken('mangalib', 1);
        expect(token).toBeNull();
    });

    it('silently ignores cacheAuthToken sendMessage failure', async () => {
        mockRuntime.sendMessage
            .mockResolvedValueOnce({ token: null })
            .mockRejectedValue(new Error('cache fail'));
        mockScripting.executeScript.mockResolvedValue([{ result: 'extracted-jwt' }]);
        const token = await AuthManager.getToken('mangalib', 7);
        expect(token).toBe('extracted-jwt');
    });

    it('uses the chrome API (via BrowserApi) when browser global is absent', async () => {
        vi.resetModules();
        delete global.browser;
        global.chrome = { runtime: { sendMessage: vi.fn().mockResolvedValue({ token: 'chrome-token' }) } };
        const { AuthManager: AM } = await import('../../core/AuthManager.js');
        const token = await AM.getToken('mangalib');
        expect(token).toBe('chrome-token');
        delete global.chrome;
    });

    it('returns null when neither browser nor chrome are available', async () => {
        vi.resetModules();
        delete global.browser;
        delete global.chrome;
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { AuthManager: AM } = await import('../../core/AuthManager.js');
        const token = await AM.getToken('mangalib');
        expect(token).toBeNull();
        warnSpy.mockRestore();
    });
});

describe('AuthManager.apply', () => {
    it('applies token to service config headers', async () => {
        mockRuntime.sendMessage.mockResolvedValue({ token: 'my-jwt' });
        const service = { name: 'mangalib' };
        const token = await AuthManager.apply('mangalib', null, service);
        expect(token).toBe('my-jwt');
        expect(service.config.headers['Authorization']).toBe('Bearer my-jwt');
    });

    it('merges with existing config headers', async () => {
        mockRuntime.sendMessage.mockResolvedValue({ token: 'my-jwt' });
        const service = { name: 'mangalib', config: { headers: { 'X-Site-Id': '1' } } };
        await AuthManager.apply('mangalib', null, service);
        expect(service.config.headers['X-Site-Id']).toBe('1');
        expect(service.config.headers['Authorization']).toBe('Bearer my-jwt');
    });

    it('returns null when no token found', async () => {
        mockRuntime.sendMessage.mockResolvedValue({ token: null });
        const service = { name: 'mangalib' };
        const token = await AuthManager.apply('mangalib', null, service);
        expect(token).toBeNull();
        expect(service.config).toBeUndefined();
    });

    it('returns null and warns when getToken throws', async () => {
        mockRuntime.sendMessage.mockRejectedValue(new Error('bg dead'));
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const service = { name: 'mangalib' };

        vi.spyOn(AuthManager, 'getToken').mockRejectedValue(new Error('inner fail'));
        const token = await AuthManager.apply('mangalib', null, service);
        expect(token).toBeNull();
        expect(warnSpy).toHaveBeenCalledWith('[AuthManager] Could not get auth token:', expect.any(Error));
        warnSpy.mockRestore();
    });
});

describe('AuthManager getToken — executeScript inner func (JWT extraction)', () => {
    const base64url = value => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const makeJwt = payload => `${base64url({ alg: 'HS256' })}.${base64url(payload)}.signature`;
    const nowSeconds = () => Math.floor(Date.now() / 1000);
    const JWT = makeJwt({ sub: '1', exp: nowSeconds() + 3600 });
    let capturedFunc;

    beforeEach(async () => {
        mockScripting.executeScript.mockImplementation(async ({ func }) => {
            capturedFunc = func;
            return [{ result: null }];
        });
        mockRuntime.sendMessage.mockResolvedValue({ token: null });
        await AuthManager.getToken('mangalib', 1);
        localStorage.clear();
        sessionStorage.clear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        localStorage.clear();
        sessionStorage.clear();
    });

    it('returns null when storage is empty', () => {
        expect(capturedFunc()).toBeNull();
    });

    it('returns null for empty-string storage value', () => {
        localStorage.setItem('empty', '');
        expect(capturedFunc()).toBeNull();
    });

    it('returns null when getItem returns null (non-string branch)', () => {
        vi.stubGlobal('localStorage', { length: 1, key: () => 'k', getItem: () => null });
        vi.stubGlobal('sessionStorage', { length: 0, key: () => null, getItem: () => null });
        expect(capturedFunc()).toBeNull();
    });

    it('returns JWT directly from localStorage', () => {
        localStorage.setItem('auth', JWT);
        expect(capturedFunc()).toBe(JWT);
    });

    it('strips Bearer prefix and returns JWT', () => {
        localStorage.setItem('token', `Bearer ${JWT}`);
        expect(capturedFunc()).toBe(JWT);
    });

    it('returns null when Bearer value is not a JWT', () => {
        localStorage.setItem('token', 'Bearer not-a-jwt');
        expect(capturedFunc()).toBeNull();
    });

    it('returns null for non-JWT plain string', () => {
        localStorage.setItem('plain', 'just-a-string');
        expect(capturedFunc()).toBeNull();
    });

    it('extracts JWT from JSON string', () => {
        localStorage.setItem('data', JSON.stringify({ token: JWT }));
        expect(capturedFunc()).toBe(JWT);
    });

    it('extracts JWT from nested JSON object', () => {
        localStorage.setItem('data', JSON.stringify({ auth: { token: JWT } }));
        expect(capturedFunc()).toBe(JWT);
    });

    it('handles JSON object with null value (scanObj null branch)', () => {
        localStorage.setItem('data', JSON.stringify({ key: null }));
        expect(capturedFunc()).toBeNull();
    });

    it('handles JSON object with numeric value (scanObj non-object branch)', () => {
        localStorage.setItem('data', JSON.stringify({ count: 42 }));
        expect(capturedFunc()).toBeNull();
    });

    it('returns null for invalid JSON string (catch branch)', () => {
        localStorage.setItem('bad', '{not valid json');
        expect(capturedFunc()).toBeNull();
    });

    it('finds JWT in sessionStorage when localStorage is empty', () => {
        sessionStorage.setItem('jwt', JWT);
        expect(capturedFunc()).toBe(JWT);
    });

    it('ignores an expired JWT', () => {
        localStorage.setItem('auth', makeJwt({ sub: '1', exp: nowSeconds() - 60 }));
        expect(capturedFunc()).toBeNull();
    });

    it('ignores a JWT that expires within the safety margin', () => {
        localStorage.setItem('auth', makeJwt({ sub: '1', exp: nowSeconds() + 10 }));
        expect(capturedFunc()).toBeNull();
    });

    it('ignores a JWT without exp', () => {
        localStorage.setItem('auth', makeJwt({ sub: '1' }));
        expect(capturedFunc()).toBeNull();
    });

    it('skips an expired JWT and returns a live one from another key', () => {
        localStorage.setItem('auth', makeJwt({ sub: 'old', exp: nowSeconds() - 60 }));
        localStorage.setItem('session', JWT);
        expect(capturedFunc()).toBe(JWT);
    });

    it('prefers keys that look like a token store', () => {
        const other = makeJwt({ sub: 'other', exp: nowSeconds() + 3600 });
        localStorage.setItem('a-analytics', other);
        localStorage.setItem('z-auth-token', JWT);
        expect(capturedFunc()).toBe(JWT);
    });
});

describe('AuthManager.invalidate', () => {
    it('asks the background to drop the token of the service', async () => {
        mockRuntime.sendMessage.mockResolvedValue({ ok: true });
        await AuthManager.invalidate('mangalib');
        expect(mockRuntime.sendMessage).toHaveBeenCalledWith({ action: 'authInvalidate', serviceKey: 'mangalib' });
    });

    it('warns instead of throwing when the background is unavailable', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        mockRuntime.sendMessage.mockRejectedValue(new Error('no receiver'));
        await expect(AuthManager.invalidate('mangalib')).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});
