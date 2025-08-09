/**
 * @fileoverview Client-side encryption utilities for Dead Man's DAO
 * Handles payload encryption, Shamir secret sharing, and IPFS/Arweave uploads
 */

const CryptoJS = require('crypto-js');
const shamir = require('shamir-secret-sharing');
const Arweave = require('arweave');

/**
 * Dead Man's DAO Encryption Client
 * Provides utilities for encrypting payloads and managing secret shares
 */
class DeadManCrypto {
    constructor(options = {}) {
        this.arweave = Arweave.init({
            host: options.arweaveHost || 'arweave.net',
            port: options.arweavePort || 443,
            protocol: options.arweaveProtocol || 'https',
            timeout: options.timeout || 20000,
            logging: options.logging || false,
        });
    }

    /**
     * Generates a random encryption key
     * @returns {string} Base64 encoded encryption key
     */
    generateEncryptionKey() {
        return CryptoJS.lib.WordArray.random(256/8).toString(CryptoJS.enc.Base64);
    }

    /**
     * Encrypts payload with AES-256-CBC
     * @param {string} payload - The data to encrypt
     * @param {string} key - Base64 encoded encryption key
     * @returns {Object} Encrypted data with IV and ciphertext
     */
    encryptPayload(payload, key) {
        try {
            const keyWordArray = CryptoJS.enc.Base64.parse(key);
            const iv = CryptoJS.lib.WordArray.random(128/8);
            
            const encrypted = CryptoJS.AES.encrypt(payload, keyWordArray, {
                iv: iv,
                mode: CryptoJS.mode.CBC,
                padding: CryptoJS.pad.Pkcs7
            });

            return {
                ciphertext: encrypted.toString(),
                iv: iv.toString(CryptoJS.enc.Base64),
                algorithm: 'AES-256-CBC',
                timestamp: Date.now()
            };
        } catch (error) {
            throw new Error(`Encryption failed: ${error.message}`);
        }
    }

    /**
     * Decrypts payload with AES-256-CBC
     * @param {Object} encryptedData - Encrypted data object
     * @param {string} key - Base64 encoded decryption key
     * @returns {string} Decrypted payload
     */
    decryptPayload(encryptedData, key) {
        try {
            const keyWordArray = CryptoJS.enc.Base64.parse(key);
            const iv = CryptoJS.enc.Base64.parse(encryptedData.iv);

            const decrypted = CryptoJS.AES.decrypt(encryptedData.ciphertext, keyWordArray, {
                iv: iv,
                mode: CryptoJS.mode.CBC,
                padding: CryptoJS.pad.Pkcs7
            });

            return decrypted.toString(CryptoJS.enc.Utf8);
        } catch (error) {
            throw new Error(`Decryption failed: ${error.message}`);
        }
    }

    /**
     * Splits encryption key using Shamir's Secret Sharing
     * @param {string} key - Base64 encoded key to split
     * @param {number} totalShares - Total number of shares to create
     * @param {number} threshold - Minimum shares needed to reconstruct
     * @returns {Array} Array of share objects
     */
    splitKey(key, totalShares, threshold) {
        try {
            if (threshold > totalShares) {
                throw new Error('Threshold cannot be greater than total shares');
            }
            if (threshold < 2) {
                throw new Error('Threshold must be at least 2');
            }
            if (totalShares > 255) {
                throw new Error('Total shares cannot exceed 255');
            }

            // Convert key to buffer
            const keyBuffer = Buffer.from(key, 'base64');
            
            // Split the key
            const shares = shamir.split(keyBuffer, {
                shares: totalShares,
                threshold: threshold
            });

            // Convert shares to base64 and add metadata
            return shares.map((share, index) => ({
                index: index + 1,
                share: share.toString('base64'),
                threshold: threshold,
                totalShares: totalShares,
                timestamp: Date.now(),
                checksum: CryptoJS.SHA256(share.toString('base64')).toString()
            }));
        } catch (error) {
            throw new Error(`Key splitting failed: ${error.message}`);
        }
    }

    /**
     * Reconstructs encryption key from shares
     * @param {Array} shares - Array of share objects
     * @returns {string} Reconstructed Base64 encoded key
     */
    reconstructKey(shares) {
        try {
            if (!Array.isArray(shares) || shares.length === 0) {
                throw new Error('Invalid shares array');
            }

            // Validate shares have required threshold
            const threshold = shares[0].threshold;
            if (shares.length < threshold) {
                throw new Error(`Insufficient shares: need ${threshold}, got ${shares.length}`);
            }

            // Verify checksums
            for (const share of shares) {
                const expectedChecksum = CryptoJS.SHA256(share.share).toString();
                if (share.checksum !== expectedChecksum) {
                    throw new Error(`Invalid checksum for share ${share.index}`);
                }
            }

            // Convert shares back to buffers
            const shareBuffers = shares.slice(0, threshold).map(shareObj => 
                Buffer.from(shareObj.share, 'base64')
            );

            // Reconstruct the key
            const reconstructedKey = shamir.combine(shareBuffers);
            
            return reconstructedKey.toString('base64');
        } catch (error) {
            throw new Error(`Key reconstruction failed: ${error.message}`);
        }
    }

    /**
     * Uploads encrypted data to Arweave
     * @param {Object} encryptedData - Encrypted payload object
     * @param {Object} wallet - Arweave wallet
     * @param {Object} tags - Additional tags for the transaction
     * @returns {Promise<string>} Transaction ID (CID equivalent)
     */
    async uploadToArweave(encryptedData, wallet, tags = {}) {
        try {
            const data = JSON.stringify(encryptedData);
            
            const transaction = await this.arweave.createTransaction({
                data: data
            }, wallet);

            // Add standard tags
            transaction.addTag('Content-Type', 'application/json');
            transaction.addTag('App-Name', 'DeadMansDAO');
            transaction.addTag('Version', '1.0');
            transaction.addTag('Type', 'EncryptedWill');
            
            // Add custom tags
            Object.entries(tags).forEach(([key, value]) => {
                transaction.addTag(key, value);
            });

            await this.arweave.transactions.sign(transaction, wallet);
            
            const response = await this.arweave.transactions.post(transaction);
            
            if (response.status === 200) {
                return transaction.id;
            } else {
                throw new Error(`Upload failed with status: ${response.status}`);
            }
        } catch (error) {
            throw new Error(`Arweave upload failed: ${error.message}`);
        }
    }

    /**
     * Downloads encrypted data from Arweave
     * @param {string} transactionId - Arweave transaction ID
     * @returns {Promise<Object>} Encrypted data object
     */
    async downloadFromArweave(transactionId) {
        try {
            const transaction = await this.arweave.transactions.get(transactionId);
            const data = await this.arweave.transactions.getData(transactionId, {
                decode: true,
                string: true
            });

            return JSON.parse(data);
        } catch (error) {
            throw new Error(`Arweave download failed: ${error.message}`);
        }
    }

    /**
     * Creates a complete will package with encryption and secret sharing
     * @param {string} payload - The will content to encrypt
     * @param {Array} guardianAddresses - Array of guardian addresses
     * @param {number} threshold - Minimum guardians needed to unlock
     * @param {Object} wallet - Arweave wallet for upload
     * @param {Object} metadata - Additional metadata
     * @returns {Promise<Object>} Complete will package
     */
    async createWillPackage(payload, guardianAddresses, threshold, wallet, metadata = {}) {
        try {
            if (threshold > guardianAddresses.length) {
                throw new Error('Threshold cannot exceed number of guardians');
            }

            // Generate encryption key and encrypt payload
            const encryptionKey = this.generateEncryptionKey();
            const encryptedPayload = this.encryptPayload(payload, encryptionKey);
            
            // Create payload hash for on-chain integrity check
            const payloadHash = CryptoJS.SHA256(JSON.stringify(encryptedPayload)).toString();

            // Split encryption key among guardians
            const keyShares = this.splitKey(encryptionKey, guardianAddresses.length, threshold);

            // Upload encrypted payload to Arweave
            const arweaveTags = {
                'Will-Hash': payloadHash,
                'Guardian-Count': guardianAddresses.length.toString(),
                'Threshold': threshold.toString(),
                ...metadata
            };
            
            const cid = await this.uploadToArweave(encryptedPayload, wallet, arweaveTags);

            // Create guardian distribution plan
            const guardianShares = guardianAddresses.map((address, index) => ({
                guardianAddress: address,
                share: keyShares[index],
                shareIndex: index + 1
            }));

            return {
                encryptedCID: cid,
                payloadHash: `0x${payloadHash}`,
                guardianShares: guardianShares,
                threshold: threshold,
                metadata: {
                    created: Date.now(),
                    algorithm: 'AES-256-CBC',
                    sharingScheme: 'Shamir',
                    ...metadata
                }
            };
        } catch (error) {
            throw new Error(`Will package creation failed: ${error.message}`);
        }
    }

    /**
     * Reconstructs and decrypts a will from guardian shares
     * @param {Array} guardianShares - Array of guardian share objects
     * @param {string} encryptedCID - Arweave CID of encrypted payload
     * @returns {Promise<string>} Decrypted will content
     */
    async reconstructWill(guardianShares, encryptedCID) {
        try {
            // Download encrypted payload
            const encryptedPayload = await this.downloadFromArweave(encryptedCID);
            
            // Extract shares from guardian objects
            const shares = guardianShares.map(gs => gs.share);
            
            // Reconstruct encryption key
            const reconstructedKey = this.reconstructKey(shares);
            
            // Decrypt and return payload
            return this.decryptPayload(encryptedPayload, reconstructedKey);
        } catch (error) {
            throw new Error(`Will reconstruction failed: ${error.message}`);
        }
    }

    /**
     * Validates a guardian share
     * @param {Object} guardianShare - Guardian share object
     * @returns {boolean} Whether share is valid
     */
    validateGuardianShare(guardianShare) {
        try {
            const required = ['index', 'share', 'threshold', 'totalShares', 'timestamp', 'checksum'];
            
            for (const field of required) {
                if (!(field in guardianShare)) {
                    return false;
                }
            }

            // Verify checksum
            const expectedChecksum = CryptoJS.SHA256(guardianShare.share).toString();
            return guardianShare.checksum === expectedChecksum;
        } catch (error) {
            return false;
        }
    }

    /**
     * Creates commitment hash for a guardian share
     * @param {Object} guardianShare - Guardian share object
     * @param {string} salt - Salt for commitment
     * @returns {string} Commitment hash
     */
    createShareCommitment(guardianShare, salt) {
        const commitment = CryptoJS.SHA256(
            guardianShare.share + guardianShare.index.toString() + salt
        ).toString();
        
        return `0x${commitment}`;
    }

    /**
     * Verifies a share commitment
     * @param {Object} guardianShare - Guardian share object
     * @param {string} salt - Salt used in commitment
     * @param {string} commitment - Expected commitment hash
     * @returns {boolean} Whether commitment is valid
     */
    verifyShareCommitment(guardianShare, salt, commitment) {
        const expectedCommitment = this.createShareCommitment(guardianShare, salt);
        return expectedCommitment === commitment;
    }
}

module.exports = DeadManCrypto;