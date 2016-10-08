import base64 from "base64-js";

const cryptography = {
  async symmetricEncrypt(key, plaintext){
    let iv = new Uint8Array(12);
    window.crypto.getRandomValues(iv);

    const encoder = new window.TextEncoder("utf-8");
    const encodedPlaintext = encoder.encode(plaintext);

    const encryptedView = await window.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv,
        tagLength: 128
      },
      key,
      encodedPlaintext
    );

    const encryptedBytes = new Uint8Array(encryptedView);
    return {
      ciphertext: base64.fromByteArray(encryptedBytes.slice(0, -16)),
      tag: base64.fromByteArray(encryptedBytes.slice(-16)),
      iv: base64.fromByteArray(iv)
    };
  },

  async symmetricDecrypt(key, ciphertextObj) {
    const {
      iv: b64IV,
      tag: b64Tag,
      ciphertext: b64Ciphertext
    } = ciphertextObj;

    const iv = base64.toByteArray(b64IV);
    const tag = base64.toByteArray(b64Tag);
    const ciphertext = base64.toByteArray(b64Ciphertext);

    const ciphertextWithTag = new Uint8Array(ciphertext.length + tag.length);
    ciphertextWithTag.set(ciphertext, 0);
    ciphertextWithTag.set(tag, ciphertext.length);

    const decryptedView = await window.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv,
        tagLength: 128
      },
      key,
      ciphertextWithTag
    );
    const decoder = new window.TextDecoder("utf-8");
    return decoder.decode(decryptedView);
  },

  async expandPassword(password, salt) {
    const encoder = new window.TextEncoder("utf-8");
    const encodedPassword = encoder.encode(password);
    const encodedSalt = encoder.encode(salt);

    const passwordAsKey = await window.crypto.subtle.importKey(
      "raw",
      encodedPassword,
      {
        name: "PBKDF2"
      },
      false,
      ["deriveKey"]
    );

    return window.crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: encodedSalt,
        iterations: 100000,
        hash: "SHA-256"
      },
      passwordAsKey,
      {name: "AES-GCM", length: 256},
      true,
      ["encrypt", "decrypt"]
    );
  },

  async sha256(str) {
    const buffer = new window.TextEncoder("utf-8").encode(str);
    const hash = await window.crypto.subtle.digest("SHA-256", buffer);
    return base64.fromByteArray(new Uint8Array(hash));
  },

  async signECDSA(privateKey, message) {
    const buffer = new window.TextEncoder("utf-8").encode(message);
    const signatureView = await window.crypto.subtle.sign(
      {
        name: "ECDSA",
        hash: {name: "SHA-256"}
      },
      privateKey,
      buffer
    );

    const signature = new Uint8Array(signatureView);
    return {
      r: base64.fromByteArray(signature.slice(0, signature.length/2)),
      s: base64.fromByteArray(signature.slice(signature.length/2))
    };
  },

  verifyECDSA(publicKey, message, signature) {
    const buffer = new window.TextEncoder("utf-8").encode(message);
    return window.crypto.subtle.verify(
      {
        name: "ECDSA",
        hash: {name: "SHA-256"}
      },
      publicKey,
      signature,
      buffer
    );
  },

  generateECDSAKeys() {
    return window.crypto.subtle.generateKey(
      {
        name: "ECDSA",
        namedCurve: "P-384"
      },
      true,
      ["sign", "verify"]
    );
  },

  generateECDHKeys() {
    return window.crypto.subtle.generateKey(
      {
        name: "ECDH",
        namedCurve: "P-384"
      },
      true,
      ["deriveKey", "deriveBits"]
    );
  }
};

module.exports = cryptography;
