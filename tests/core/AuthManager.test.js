import { describe, it, expect, beforeEach, vi } from 'vitest';

let AuthManager;
let mockRuntime;
let mockScripting;

beforeEach(async () => {
    vi.resetModules();

    delete global.getExtensionApi;
    if (typeof window !== 'undefined') delete window.getExtensionApi;

    mockRuntime = { sendMessage: vi.fn() };
    mockScripting = { executeScript: vi.fn() };

    const browserMock = { runtime: mockRuntime, scripting: mockScripting };
    global.browser = browserMock;
    if (typeof window !== 'undefined') window.browser = browserMock;

    await import('../../core/AuthManager.js');
    AuthManager = (typeof window !== 'undefined' ? window : global).AuthManager;
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
        delete global.getExtensionApi;
        if (typeof window !== 'undefined') delete window.getExtensionApi;
        const browserMock = { runtime: { sendMessage: vi.fn().mockResolvedValue({ token: null }) } };
        global.browser = browserMock;
        if (typeof window !== 'undefined') window.browser = browserMock;
        await import('../../core/AuthManager.js');
        const AM = (typeof window !== 'undefined' ? window : global).AuthManager;
        const token = await AM.getToken('mangalib', 1);
        expect(token).toBeNull();
    });

    it('uses getExtensionApi() when it is a function', async () => {
        vi.resetModules();
        const host = typeof window !== 'undefined' ? window : global;
        const mockApi = { runtime: { sendMessage: vi.fn().mockResolvedValue({ token: 'via-getter' }) } };
        host.getExtensionApi = () => mockApi;
        await import('../../core/AuthManager.js');
        const AM = host.AuthManager;
        const token = await AM.getToken('mangalib');
        expect(token).toBe('via-getter');
        delete host.getExtensionApi;
    });

    it('silently ignores cacheAuthToken sendMessage failure', async () => {
        mockRuntime.sendMessage
            .mockResolvedValueOnce({ token: null })
            .mockRejectedValue(new Error('cache fail'));
        mockScripting.executeScript.mockResolvedValue([{ result: 'extracted-jwt' }]);
        const token = await AuthManager.getToken('mangalib', 7);
        expect(token).toBe('extracted-jwt');
    });

    it('falls back to chrome API when browser global is absent', async () => {
        vi.resetModules();
        const host = typeof window !== 'undefined' ? window : global;
        delete host.getExtensionApi;
        delete host.browser;
        const mockChrome = { runtime: { sendMessage: vi.fn().mockResolvedValue({ token: 'chrome-token' }) } };
        host.chrome = mockChrome;
        await import('../../core/AuthManager.js');
        const AM = host.AuthManager;
        const token = await AM.getToken('mangalib');
        expect(token).toBe('chrome-token');
        delete host.chrome;
    });

    it('returns null when neither browser nor chrome are available', async () => {
        vi.resetModules();
        const host = typeof window !== 'undefined' ? window : global;
        delete host.getExtensionApi;
        delete host.browser;
        delete host.chrome;
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await import('../../core/AuthManager.js');
        const AM = host.AuthManager;
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
    const JWT = 'eyJhbGc.eyJzdWI.SflKxwRJ';
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
});
