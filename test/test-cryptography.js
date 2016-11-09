
import cryptography from "../src/js/cryptography.js";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const assert = chai.assert;

describe('cryptography', function(){
  describe('#symmetricEncrypt', function () {
    it('should round trip', async function(){
      const key = await window.crypto.subtle.generateKey(
        {
          name: "AES-GCM",
          length: 256
        },
        false,
        ["encrypt", "decrypt"]
      );
      const testText = "some text";

      const encrypted = await cryptography.symmetricEncrypt(key, testText);
      const decrypted = await cryptography.symmetricDecrypt(key, encrypted);
      assert(decrypted === testText);
    });

    it('should create an object with ciphertext, iv, and tag', async function(){
      const key = await window.crypto.subtle.generateKey(
        {
          name: "AES-GCM",
          length: 256
        },
        false,
        ["encrypt", "decrypt"]
      );
      const testText = "some text";

      const encrypted = await cryptography.symmetricEncrypt(key, testText);

      assert.property(encrypted, "ciphertext");
      assert.property(encrypted, "tag");
      assert.property(encrypted, "iv");
    });
  });

  describe('#symmetricDecrypt', function () {
    it('should decrypt valid data', async function(){
      const key = await window.crypto.subtle.generateKey(
        {
          name: "AES-GCM",
          length: 256
        },
        false,
        ["encrypt", "decrypt"]
      );
      const testText = "some text";

      const encrypted = await cryptography.symmetricEncrypt(key, testText);
      const decrypted = await cryptography.symmetricDecrypt(key, encrypted);
      assert(decrypted === testText);
    });

    it('should be rejected when missing IV', async function(){
      const key = await window.crypto.subtle.generateKey(
        {
          name: "AES-GCM",
          length: 256
        },
        false,
        ["encrypt", "decrypt"]
      );
      const testText = "some text";

      const encrypted = await cryptography.symmetricEncrypt(key, testText);
      encrypted.iv = undefined;

      return assert.isRejected(cryptography.symmetricDecrypt(key, encrypted));
    });

    it('should be rejected when ciphertext is modified', async function(){
      const key = await window.crypto.subtle.generateKey(
        {
          name: "AES-GCM",
          length: 256
        },
        false,
        ["encrypt", "decrypt"]
      );
      const testText = "some text";

      const encrypted = await cryptography.symmetricEncrypt(key, testText);
      encrypted.ciphertext = encrypted.ciphertext.substring(1);

      return assert.isRejected(cryptography.symmetricDecrypt(key, encrypted));
    });
  });


  describe('#signECDSA', function () {
    it('should return an object with properties `r` and `s`', async function(){
      const {publicKey: pub, privateKey: priv} =
            await cryptography.generateECDSAKeys();

      const message = "some text";
      const signature = await cryptography.signECDSA(priv, message);
      assert.property(signature, "r");
      assert.property(signature, "s");
    });

    it('should create a verifiable signature', async function(){
      const {publicKey: pub, privateKey: priv} =
            await cryptography.generateECDSAKeys();

      const message = "some text";
      const signature = await cryptography.signECDSA(priv, message);

      assert(await cryptography.verifyECDSA(pub, message, signature));
    });
  });

  describe('#verifyECDSA', function () {
    it('should return false when signature does not match', async function(){
      const {publicKey: pub, privateKey: priv} =
            await cryptography.generateECDSAKeys();

      const message = "some text";
      const signature = await cryptography.signECDSA(priv, message);

      assert(!await cryptography.verifyECDSA(pub, "text", signature));
    });
  });
});
