import base64 from "base64-js";
import superagent from "superagent";
import SuperagentPromise from "superagent-promise";
import ChromePromise from "chrome-promise";

import Keystore from "./keystore.js";
import cryptography from "./cryptography.js";

const agent = SuperagentPromise(superagent, Promise);
const chromep = new ChromePromise();

var selfpass = (function(){
  var state = {
    paired: false,
    username: null,
    userID: null,
    deviceID: null,
    userKeys: null,
    serverAddress: null,
    serverPubKey: null,
    lastKeystoreTag: null,
    keystore: new Keystore(),

    masterKey: null
  };

  async function updateUserData(key, value) {
    if (!isLoggedIn()) {
      throw Error("Cannot update user info before logging in");
    }

    const result = await chromep.storage.local.get("connectionData");
    result.connectionData.users[state.userID][key] = value;
    chromep.storage.local.set(result);
  }

  async function completeHello(tempPrivKey, response) {
    const r = base64.toByteArray(response.signature.r);
    const s = base64.toByteArray(response.signature.s);

    const signature = new Uint8Array(r.length + s.length);
    signature.set(r, 0);
    signature.set(s, r.length);

    const validSignature =
        await cryptography.verifyECDSA(state.serverPubKey,
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

  async function sendEncryptedRequest(method, requestData) {
    const tempKeys = await cryptography.generateECDHKeys();
    const tempPubKey = tempKeys.publicKey;
    const tempPrivKey = tempKeys.privateKey;

    const exportedPubKey = await window.crypto.subtle.exportKey("jwk", tempPubKey);
    const pubKeyStr = window.btoa(JSON.stringify({
      public_key: exportedPubKey
    }));

    const signature = await cryptography.signECDSA(state.userKeys.privateKey,
                                                   pubKeyStr);
    const helloKeyInfo = {
      payload: pubKeyStr,
      signature: signature,
      user_id: state.userID,
      device_id: state.deviceID
    };

    // Send our ephemeral public key to the server
    const helloResponse = await agent.post(state.serverAddress + "/hello")
          .send(helloKeyInfo)
          .set('Accept', 'application/json');

    // Do the ECDH and get the ephemeral symmetric key
    const [tempSharedKey, session_id] =
          await completeHello(tempPrivKey, helloResponse.body);


    const plaintextPayload = {
      "request": method,
      "data": requestData
    };
    const payload = await cryptography.symmetricEncrypt(tempSharedKey,
                                                        JSON.stringify(plaintextPayload));
    payload["session_id"] = session_id;

    // Send the actual payload (encrypted with the ephemeral key)
    const finalResponse = await agent.post(state.serverAddress + "/request")
          .send(payload)
          .set('Accept', 'application/json');

    const decryptedResponse =
          await cryptography.symmetricDecrypt(tempSharedKey, finalResponse.body);
    const decodedResponse = JSON.parse(decryptedResponse);

    console.log(decodedResponse);
    return decodedResponse;
  }

  async function getCurrentKeystore(skipUpdate) {
    const response = await sendEncryptedRequest("retrieve-keystore", {"current":state.lastKeystoreTag});
    if (response["response"] === "CURRENT") {
      return [state.keystore, null];
    }

    const encryptedKeystore = JSON.parse(response["data"]);

    const decryptedKeystore =
          await cryptography.symmetricDecrypt(state.masterKey, encryptedKeystore);
    const parsedKeystore = new Keystore(JSON.parse(decryptedKeystore));

    if (!skipUpdate) {
      state.keystore = parsedKeystore;
      state.lastKeystoreTag = encryptedKeystore.tag;
      updateUserData("lastKeystoreTag", state.lastKeystoreTag);
      chromep.storage.local.set({"keystores": {[state.userID]: encryptedKeystore}})
        .then(() => {
          console.log("Updated keystore");
      });
    }

    return [parsedKeystore, encryptedKeystore];
  }

  function isLoggedIn() {
    return state.masterKey !== null;
  }

  async function sendUpdatedKeystore(keystore) {
    if (!isLoggedIn()) {
      throw Error("Cannot sendUpdatedKeystore before logging in.");
    }

    const encryptedKeystore =
          await cryptography.symmetricEncrypt(state.masterKey, keystore.serialize());
    const data = {
      "keystore": encryptedKeystore,
      "user_id": state.userID,
      "based_on": state.lastKeystoreTag
    };
    const response = await sendEncryptedRequest("update-keystore", JSON.stringify(data));

    if (response.response === "OUTDATED") {
      console.log("Current keystore is outdated, getting current keystore");
      const [currentKeystore, encryptedCurrentKeystore] = await getCurrentKeystore(true);

      //TODO merge keystores

      state.lastKeystoreTag = encryptedCurrentKeystore.tag;
      chromep.storage.local.set({"keystores": {[state.userID]: encryptedKeystore}});
      updateUserData("lastKeystoreTag", state.lastKeystoreTag);

      console.log("Got current keystore, sending merged keystore");
      sendUpdatedKeystore(keystore);
    }
  }

  function isPaired() {
    return !!state.paired;
  }

  function init(userID_, username_) {
    state.userID = userID_;
    state.username = username_;
  }

  async function loginFirstTime(masterKey_) {
    if (!isPaired()) {
      throw Error("Cannot login before pairing.");
    }

    const masterKey = await cryptography.expandPassword(masterKey_,
                                                        state.userID);
    state.masterKey = masterKey;
    console.log("Finished First time log in.");

    const encryptedKeystore =
          await cryptography.symmetricEncrypt(state.masterKey, state.keystore.serialize());

    chromep.storage.local.set({"keystores": {[state.userID]: encryptedKeystore}})
      .then(() => {
        console.log("Stored encrypted keystore (first time)");
      });

    // This should be an empty object. Send it so the server
    // has something stored for the new user.
    sendUpdatedKeystore(state.keystore);
  }

  async function login(masterKey_, onSuccess, onError) {
    if (!isPaired()) {
      throw Error("Cannot login before pairing.");
    }

    const providedKey = await cryptography.expandPassword(masterKey_, state.userID);
    console.log("Reading current keystore.");

    const result = await chromep.storage.local.get("keystores");

    try {
      const encryptedKeystore = result.keystores[state.userID];

      const decryptedKeystore =
            await cryptography.symmetricDecrypt(providedKey, encryptedKeystore);
      const parsedKeystore = JSON.parse(decryptedKeystore);

      console.log("Used provided key to decrypt current keystore");

      state.keystore = new Keystore(parsedKeystore);
      state.masterKey = providedKey;
      console.log("Getting updated keystore.");
      getCurrentKeystore();

      console.log("Finished logging in.");
      if (onSuccess) {
        onSuccess();
      }
    } catch (error) {
      state.masterKey = null;
      console.error("Error logging in:", error);
      if (onError) {
        onError(error);
      }
    }
  }

  async function generatePairingInfo(combinedAccessKey, username) {
    const userID = await cryptography.sha256(username);
    const deviceID = cryptography.generateDeviceID();
    const [accessKeyID, accessKey] = [combinedAccessKey.slice(0, 2),
                                      combinedAccessKey.slice(2)];

    const expandedAccessKey = await cryptography.expandPassword(
      accessKey.replace(/-/g, ''), userID);

    const clientKeys = await cryptography.generateECDSAKeys();
    const pub = clientKeys.publicKey;

    const exportedClientPub = await window.crypto.subtle.exportKey("jwk", pub);
    console.log("Exported client key: ", exportedClientPub);

    const message = {
      request: "register-device",
      device_id: deviceID,
      public_key: exportedClientPub
    };

    const payload = await cryptography.symmetricEncrypt(expandedAccessKey,
                                                        JSON.stringify(message));
    payload["user_id"] = userID;
    payload["access_key_id"] = accessKeyID;

    return [userID, deviceID, expandedAccessKey, clientKeys, payload];
  }

  async function pairDevice(combinedAccessKey,
                            remoteServerLocation,
                            username,
                            masterKey) {
    const [userID, deviceID, expandedAccessKey, clientKeys, payload] =
            await generatePairingInfo(combinedAccessKey, username);

    const encryptedResponse = await agent.post(remoteServerLocation + "/pair")
          .send(payload)
          .set('Accept', 'application/json');

    const response = await cryptography.symmetricDecrypt(expandedAccessKey,
                                                         encryptedResponse.body);
    const message = JSON.parse(response);
    const serverPubKey = await window.crypto.subtle.importKey(
      "jwk",
      message.public_key,
      {
        name: "ECDSA",
        namedCurve: "P-384"
      },
      true,
      ["verify"]);

    state.serverPubKey = serverPubKey;
    state.deviceID = deviceID;
    state.serverAddress = remoteServerLocation;
    state.paired = true;

    state.userKeys = {
      publicKey: clientKeys.publicKey,
      privateKey: clientKeys.privateKey
    };

    savePairInfo(remoteServerLocation, username,
                 userID, deviceID, state.userKeys,
                 state.serverPubKey).then(() => {
                   state.paired = true;
                   init(userID, username);

                   console.log("Pairing complete");
                   loginFirstTime(masterKey);
                 });
  }

  async function savePairInfo(serverAddress, username, userID, deviceID,
                              userKeys, serverPubKey) {
    const exportedUserPub =
            await window.crypto.subtle.exportKey("jwk", userKeys.publicKey);
    const exportedUserPriv =
            await window.crypto.subtle.exportKey("jwk", userKeys.privateKey);
    const exportedServerPub =
            await window.crypto.subtle.exportKey("jwk", serverPubKey);

    const users = await chromep.storage.local.get("users");
    users[userID] = {
      username: username,
      deviceID: deviceID,
      keys: {
        publicKey: exportedUserPub,
        privateKey: exportedUserPriv
      }
    };

    const data = {
      connectionData : {
        paired: true,
        serverAddress: serverAddress,
        serverPubKey: exportedServerPub,
        lastUser: userID,
        users: users
      }
    };

    chromep.storage.local.set(data).then(() => {
      console.log("Saved pairing parameters");
    }).catch(() =>{
      console.error("An error occurred while saving pairing parameters");
    });
  }

  function unpair() {
    if (isLoggedIn()) {
      logout();
    }
    chromep.storage.local.remove("connectionData");
    chromep.storage.local.remove("keystores." + state.userID);
    state.paired = false;
  }

  function logout() {
    state.masterKey = null;
    state.keystore = null;
    console.log("Logged out.");
  }

  async function startup() {
    const result = await chromep.storage.local.get("connectionData");
    const connectionData = result.connectionData;

    if (typeof(connectionData) === "undefined") {
      console.log("Unpaired.");
      return;
    }

    const userID = connectionData.lastUser;
    const user = connectionData.users[userID];
    const username = user.username;

    state.deviceID = user.deviceID;
    state.paired = connectionData.paired;
    state.serverAddress = connectionData.serverAddress;
    console.log("Loaded lastKeystoreTag:", user.lastKeystoreTag || null);
    state.lastKeystoreTag = user.lastKeystoreTag || null;

    const serverPubKey = await window.crypto.subtle.importKey(
      "jwk",
      connectionData.serverPubKey,
      {
        name: "ECDSA",
        namedCurve: "P-384"
      },
      false,
      ["verify"]
    );

    // Currently unused
    const clientPub = await window.crypto.subtle.importKey(
      "jwk",
      user.keys.publicKey,
      {
        name: "ECDSA",
        namedCurve: "P-384"
      },
      false,
      []
    );

    const clientPriv = await window.crypto.subtle.importKey(
      "jwk",
      user.keys.privateKey,
      {
        name: "ECDSA",
        namedCurve: "P-384"
      },
      false,
      ["sign"]
    );

    state.serverPubKey = serverPubKey;
    state.userKeys = {
      privateKey: clientPriv,
      publicKey: clientPub
    };

    console.log("Already paired.");
    init(userID, username);
    console.log("Loaded user `" + username + "` (" + userID + ")");
  }

  startup();

  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse){
    console.log(request, sender);
    if (request.message === "get-credentials") {
      sendResponse(state.keystore.currentCredentialsMatching(sender.tab.url));
    } else if (request.message === "get-keystore") {
      sendResponse(state.keystore);
    } else if (request.message === "login-status") {
      sendResponse({isLoggedIn:isLoggedIn()});
    } else if (request.message === "logout") {
      logout();
    } else if (request.message === "save-credentials") {
      state.keystore.addCredentials(request.url,
                                    request.username,
                                    request.password,
                                    request.favicon);
      sendUpdatedKeystore(state.keystore);
    } else if (request.message === "fill-credentials"         ||
               request.message === "fill-generated-password"  ||
               request.message === "close-fill-popup"         ||
               request.message === "request-save-credentials" ||
               request.message === "close-generate-popup") {
      // proxy fill-credentials/close requests for the iframe back to the
      // originating tab
      chrome.tabs.sendMessage(sender.tab.id, request);
    }
  });

  return {
    login: login,
    logout: logout,
    isLoggedIn: isLoggedIn,
    unpair: unpair,
    pairDevice: pairDevice,
    isPaired: isPaired,
    getCurrentKeystore: getCurrentKeystore,
    keystore: function(){return state.keystore;},
    state: function(){return state;}
  };
})();

window.selfpass = selfpass;
