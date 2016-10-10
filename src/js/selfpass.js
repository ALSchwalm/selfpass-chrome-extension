import base64 from "base64-js";
import superagent from "superagent";
import superagentPromise from "superagent-promise";
const agent = superagentPromise(superagent, Promise);

import cryptography from "./cryptography.js";

class Keystore {
  constructor(store) {
    if (typeof(store) === "undefined") {
      this.store = {};
    } else {
      this.store = store;
    }
  }

  parseURI(uri) {
    const parser = document.createElement('a');
    parser.href = uri;
    return parser;
  }

  addCredentials(uri, username, password, favicon) {
    const host = this.parseURI(uri).host;
    const entry = {
      host: host,
      uri: uri,
      username: username,
      password: password,
      favicon: favicon,
      time: new Date()
    };

    if (typeof(this.store[host]) === "undefined") {
      this.store[host] = {};
    }
    if (typeof(this.store[host][username] === "undefined")) {
      this.store[host][username] = [];
    }
    this.store[host][username].push(entry);
  }

  credentialsForUrl(uri) {
    const host = this.parseURI(uri).host;
    if (typeof(this.store[host]) === "undefined") {
      return [];
    }

    var currentCredentials = [];
    for(const username in this.store[host]) {
      const history = this.store[host][username];
      currentCredentials.push(history[history.length]);
    }
    return currentCredentials;
  }

  serialize() {
    return JSON.stringify(this.store);
  }

  removeSite(uri){
    const host = this.parseURI(uri).host;

    // This should be removed after the next merge
    this.store[host] = null;
  }
}

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

  function updateUserData(key, value) {
    if (!isLoggedIn()) {
      throw Error("Cannot update user info before logging in");
    }

    chrome.storage.local.get("connectionData", function(result){
      result.connectionData.users[state.userID][key] = value;
      chrome.storage.local.set(result);
    });
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

  function generateDeviceID() {
    let id = new Uint8Array(32);
    window.crypto.getRandomValues(id);
    let hexID = '';
    for (let i = 0; i < id.length; ++i) {
      let hex = id[i].toString(16);
      hex = ("0" + hex).substr(-2);
      hexID += hex;
    }
    return hexID;
  }

  async function getCurrentKeystore(callback) {
    const response = await sendEncryptedRequest("retrieve-keystore", {"current":state.lastKeystoreTag});
    if (response["response"] === "CURRENT") {
      //TODO: execute callback?
      return;
    }

    const encryptedKeystore = JSON.parse(response["data"]);

    const decryptedKeystore =
          await cryptography.symmetricDecrypt(state.masterKey, encryptedKeystore);
    const parsedKeystore = new Keystore(JSON.parse(decryptedKeystore));

    if (typeof(callback) === "undefined") {
      state.keystore = parsedKeystore;
      state.lastKeystoreTag = encryptedKeystore.tag;
      updateUserData("lastKeystoreTag", state.lastKeystoreTag);
      chrome.storage.local.set({"keystores": {[state.userID]: encryptedKeystore}},
                                 function(){
          console.log("Updated keystore");
      });
    } else {
      callback(parsedKeystore, encryptedKeystore);
    }
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
      getCurrentKeystore(function(currentKeystore, encryptedCurrentKeystore){
        //TODO merge keystores

        state.lastKeystoreTag = encryptedCurrentKeystore.tag;
        chrome.storage.local.set({"keystores": {[state.userID]: encryptedKeystore}});
        updateUserData("lastKeystoreTag", state.lastKeystoreTag);

        console.log("Got current keystore, sending merged keystore");
        sendUpdatedKeystore(keystore);
      });
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

    chrome.storage.local.set(
      {"keystores": {[state.userID]: encryptedKeystore}},
      function(){
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

    chrome.storage.local.get("keystores", async function(result){
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
      }catch (error) {
        state.masterKey = null;
        console.error("Error logging in:", error);
        if (onError) {
          onError(error);
        }
      }
    });
  }

  async function generatePairingInfo(combinedAccessKey, username) {
    const userID = await cryptography.sha256(username);
    const deviceID = generateDeviceID();
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

    chrome.storage.local.get("users", function(users){
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

      chrome.storage.local.set(data, function() {
        if (!chrome.extension.lastError) {
          console.log("Saved pairing parameters");
        } else {
          console.error("An error occurred while saving pairing parameters");
        }
      });
    });
  }

  function unpair() {
    if (isLoggedIn()) {
      logout();
    }
    chrome.storage.local.remove("connectionData");
    chrome.storage.local.remove("keystores." + state.userID);
    state.paired = false;
  }

  function logout() {
    state.masterKey = null;
    state.keystore = null;
    console.log("Logged out.");
  }

  function startup() {
    chrome.storage.local.get("connectionData", async function(result){
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
    });
  }

  startup();

  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse){
    console.log(request, sender);
    if (request.message === "get-credentials") {
      sendResponse(state.keystore.credentialsForUrl(sender.tab.url));
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
