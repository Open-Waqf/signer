
export class WebAuthnService {
    private static STORAGE_KEY = 'signer_webauthn_credential';

    static async getAvailabilityStatus(): Promise<{ available: boolean; reason: string }> {
        if (!window.isSecureContext) {
            return {available: false, reason: 'insecure-context'};
        }
        if (!('PublicKeyCredential' in window) || !window.PublicKeyCredential) {
            return {available: false, reason: 'no-public-key-credential'};
        }
        const uvpaCheck = (window.PublicKeyCredential as any).isUserVerifyingPlatformAuthenticatorAvailable;
        if (typeof uvpaCheck !== 'function') {
            return {available: false, reason: 'no-uvpa-check'};
        }
        if (!navigator.credentials || typeof navigator.credentials.get !== 'function' || typeof navigator.credentials.create !== 'function') {
            return {available: false, reason: 'no-credentials-api'};
        }
        try {
            const hasPlatformAuthenticator = await uvpaCheck.call(window.PublicKeyCredential);
            if (!hasPlatformAuthenticator) {
                return {available: false, reason: 'no-platform-authenticator'};
            }
        } catch {
            return {available: false, reason: 'uvpa-check-failed'};
        }
        return {available: true, reason: 'ok'};
    }

    static async isAvailable(): Promise<boolean> {
        const status = await this.getAvailabilityStatus();
        return status.available;
    }

    private static bufferToBase64(buffer: ArrayBuffer): string {
        return btoa(String.fromCharCode(...new Uint8Array(buffer)));
    }

    private static base64ToBuffer(base64: string): ArrayBuffer {
        return Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer;
    }

    private static base64UrlToUint8Array(base64url: string): Uint8Array {
        const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
        const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
        return new Uint8Array(this.base64ToBuffer(base64));
    }

    static async register(challenge: Uint8Array, userName: string = 'User'): Promise<{ id: string; publicKeySpki: string }> {
        const rpId = window.location.hostname || 'localhost';
        
        const createOptions: PublicKeyCredentialCreationOptions = {
            challenge: challenge.buffer as any,
            rp: {
                name: 'Open Waqf Signer',
                id: rpId
            },
            user: {
                id: crypto.getRandomValues(new Uint8Array(16)),
                name: userName,
                displayName: userName
            },
            pubKeyCredParams: [
                { type: 'public-key', alg: -7 }, // ES256 (ECDSA)
                { type: 'public-key', alg: -257 } // RS256
            ],
            authenticatorSelection: {
                userVerification: 'required',
                authenticatorAttachment: 'platform'
            },
            timeout: 60000,
            attestation: 'none'
        };

        const credential = await navigator.credentials.create({
            publicKey: createOptions
        }) as any;

        if (!credential) throw new Error('Failed to create credential');

        // Extract SPKI public key if available (Standard in modern browsers)
        let publicKeySpki = '';
        if (typeof credential.getPublicKey === 'function') {
            const spkiBuffer = credential.getPublicKey();
            publicKeySpki = this.bufferToBase64(spkiBuffer);
        } else {
            // Fallback mode: allow signing flow even if SPKI extraction is unavailable.
            // Hardware assertion is still produced; local offline cryptographic verification
            // may be skipped later when the public key is missing.
            console.warn('WebAuthn: Public Key extraction not supported on this browser, continuing without local SPKI.');
        }

        const credInfo = {
            id: credential.id,
            rawId: this.bufferToBase64(credential.rawId),
            publicKeySpki
        };

        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(credInfo));
        
        return {
            id: credential.id,
            publicKeySpki
        };
    }

    static async sign(documentHash: Uint8Array, userName: string = 'User'): Promise<{ 
        signature: string; 
        authData: string; 
        clientDataJSON: string;
        publicKeySpki: string;
        credentialId: string;
    }> {
        const stored = localStorage.getItem(this.STORAGE_KEY);
        let credInfo: any;
        
        if (!stored) {
            const reg = await this.register(documentHash, userName);
            credInfo = { 
                id: reg.id, 
                rawId: this.bufferToBase64(this.base64ToBuffer(btoa(reg.id))), // simple placeholder
                publicKeySpki: reg.publicKeySpki 
            };
            // The registration itself is a proof of presence, 
            // but for a strict assertion we might want to re-call .get
        } else {
            credInfo = JSON.parse(stored);
        }

        const rpId = window.location.hostname || 'localhost';

        const getOptions: PublicKeyCredentialRequestOptions = {
            challenge: documentHash.buffer as any,
            rpId,
            allowCredentials: [{
                id: this.base64ToBuffer(credInfo.id.includes('=') ? credInfo.id : btoa(credInfo.id).replace(/=/g,'')), // cleanup id format
                type: 'public-key'
            }],
            userVerification: 'required',
            timeout: 60000
        };

        // Fix rawId vs id handling
        getOptions.allowCredentials![0].id = this.base64ToBuffer(credInfo.rawId);

        const assertion = await navigator.credentials.get({
            publicKey: getOptions
        }) as PublicKeyCredential;

        if (!assertion) throw new Error('Failed to sign');
        
        const response = assertion.response as AuthenticatorAssertionResponse;
        
        return {
            signature: this.bufferToBase64(response.signature),
            authData: this.bufferToBase64(response.authenticatorData),
            clientDataJSON: this.bufferToBase64(response.clientDataJSON),
            publicKeySpki: credInfo.publicKeySpki,
            credentialId: assertion.id
        };
    }

    /**
     * LOCAL browser-only verification
     */
    static async verifyLocal(
        publicKeySpki: string,
        signature: string,
        authData: string,
        clientDataJSON: string,
        expectedChallenge?: Uint8Array
    ): Promise<boolean> {
        try {
            if (!publicKeySpki) return false;
            const pubKeyBuffer = this.base64ToBuffer(publicKeySpki);
            const sigBuffer = this.base64ToBuffer(signature);
            const authDataBuffer = this.base64ToBuffer(authData);
            const clientDataBuffer = this.base64ToBuffer(clientDataJSON);
            const clientDataText = new TextDecoder().decode(clientDataBuffer);
            const parsedClientData = JSON.parse(clientDataText);

            if (expectedChallenge) {
                const challengeBytes = this.base64UrlToUint8Array(parsedClientData.challenge || '');
                if (challengeBytes.length !== expectedChallenge.length) return false;
                for (let i = 0; i < challengeBytes.length; i++) {
                    if (challengeBytes[i] !== expectedChallenge[i]) return false;
                }
            }

            // 1. Import Key
            // We assume ES256 for biometric signatures
            const key = await crypto.subtle.importKey(
                'spki',
                pubKeyBuffer,
                { name: 'ECDSA', namedCurve: 'P-256' },
                false,
                ['verify']
            );

            // 2. Reconstruct signed data: authData + sha256(clientDataJSON)
            const clientDataHash = await crypto.subtle.digest('SHA-256', clientDataBuffer);
            const signedData = new Uint8Array(authDataBuffer.byteLength + clientDataHash.byteLength);
            signedData.set(new Uint8Array(authDataBuffer), 0);
            signedData.set(new Uint8Array(clientDataHash), authDataBuffer.byteLength);

            // 3. Verify
            return await crypto.subtle.verify(
                { name: 'ECDSA', hash: 'SHA-256' },
                key,
                sigBuffer,
                signedData
            );
        } catch (e) {
            console.error('Local Verification Error', e);
            return false;
        }
    }

    static clear() {
        localStorage.removeItem(this.STORAGE_KEY);
    }
}
