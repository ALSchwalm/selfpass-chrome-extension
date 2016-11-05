import base64 from "base64-js";
import superagent from "superagent";
import SuperagentPromise from "superagent-promise";
import cryptography from "./cryptography.js";

const agent = SuperagentPromise(superagent, Promise);

class Connection {
  constructor(serverAddress, userID, deviceID, userPrivateKey, serverPubKey) {
    this.serverAddress = serverAddress;
    this.userID = userID;
    this.deviceID = deviceID;
    this.serverPubKey = serverPubKey;
    this.userPrivateKey = userPrivateKey;
  }

  async _completeHello(tempPrivKey, response) {
    const r = base64.toByteArray(response.signature.r);
    const s = base64.toByteArray(response.signature.s);

    const signature = new Uint8Array(r.length + s.length);
    signature.set(r, 0);
    signature.set(s, r.length);

    const validSignature =
        await cryptography.verifyECDSA(this.serverPubKey,
                                       response.payload,
                                       signature);
    if (!validSignature) {
      throw Error("Invalid signature");
    }

    const parsedResponse = JSON.parse(window.atob(response.payload));
    const serverTempPubKey = await window.crypto.subtle.importKey(
      "jwk",
      parsedResponse.public_key,
      {
        name: "ECDH",
        namedCurve: "P-384"
      },
      false,
      []);

    const tempSymmetricKey = await window.crypto.subtle.deriveKey(
      {
        name: "ECDH",
        namedCurve: "P-384",
        public: serverTempPubKey
      },
      tempPrivKey,
      {
        name: "AES-GCM",
        length: 256
      },
      false,
      ["encrypt", "decrypt"]
    );

    return [tempSymmetricKey, parsedResponse.session_id];
  }

  async sendEncryptedRequest(method, requestData) {
    const tempKeys = await cryptography.generateECDHKeys();
    const tempPubKey = tempKeys.publicKey;
    const tempPrivKey = tempKeys.privateKey;

    const exportedPubKey = await window.crypto.subtle.exportKey("jwk", tempPubKey);
    const pubKeyStr = window.btoa(JSON.stringify({
      public_key: exportedPubKey
    }));

    const signature = await cryptography.signECDSA(this.userPrivateKey,
                                                   pubKeyStr);
    const helloKeyInfo = {
      payload: pubKeyStr,
      signature: signature,
      user_id: this.userID,
      device_id: this.deviceID
    };

    // Send our ephemeral public key to the server
    const helloResponse = await agent.post(this.serverAddress + "/hello")
          .send(helloKeyInfo)
          .set('Accept', 'application/json');

    // Do the ECDH and get the ephemeral symmetric key
    const [tempSharedKey, session_id] =
          await this._completeHello(tempPrivKey, helloResponse.body);


    const plaintextPayload = {
      "request": method,
      "data": requestData
    };
    const payload = await cryptography.symmetricEncrypt(tempSharedKey,
                                                             JSON.stringify(plaintextPayload));
    payload["session_id"] = session_id;

    // Send the actual payload (encrypted with the ephemeral key)
    const finalResponse = await agent.post(this.serverAddress + "/request")
          .send(payload)
          .set('Accept', 'application/json');

    const decryptedResponse =
          await cryptography.symmetricDecrypt(tempSharedKey, finalResponse.body);
    const decodedResponse = JSON.parse(decryptedResponse);

    console.log(decodedResponse);
    return decodedResponse;
  }
}

module.exports = Connection;
