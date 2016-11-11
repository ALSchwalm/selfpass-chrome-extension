import base64 from "base64-js";
import superagent from "superagent";
import SuperagentPromise from "superagent-promise";
import ChromePromise from "chrome-promise";

import Keystore from "./keystore.js";
import Connection from "./connection.js";
import cryptography from "./cryptography.js";

const agent = SuperagentPromise(superagent, Promise);
const chromep = new ChromePromise();

var selfpass = (function(){
  var state = {
    paired: false,
    username: null,
    userID: null,
    connection: null,
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

  function isLoggedIn() {
    return state.masterKey !== null;
  }


  function isPaired() {
    return !!state.paired;
  }

  function init(userID_, username_) {
    state.userID = userID_;
    state.username = username_;
  }

  async function getCurrentKeystore(connection, skipUpdate) {
    const response = await connection.sendEncryptedRequest("retrieve-keystore",
                                                           {"current":state.lastKeystoreTag});
    if (response["response"] === "CURRENT" || response["data"] === null) {
      return [state.keystore, null];
    }

    const encryptedKeystore = JSON.parse(response["data"]);

    const decryptedKeystore =
          await cryptography.symmetricDecrypt(state.masterKey, encryptedKeystore);
    const parsedKeystore = new Keystore(JSON.parse(decryptedKeystore));

    if (!skipUpdate) {
      state.keystore.merge(parsedKeystore);
      state.lastKeystoreTag = encryptedKeystore.tag;
      updateUserData("lastKeystoreTag", state.lastKeystoreTag);
      chromep.storage.local.set({"keystores": {[state.userID]: encryptedKeystore}})
        .then(() => {
          console.log("Updated keystore");
      });
    }

    return [parsedKeystore, encryptedKeystore];
  }

  async function sendUpdatedKeystore(connection, keystore) {
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
    const response = await connection.sendEncryptedRequest("update-keystore",
                                                           JSON.stringify(data));

    if (response.response === "OUTDATED") {
      console.log("Current keystore is outdated, getting current keystore");
      const [currentKeystore, encryptedCurrentKeystore] =
            await getCurrentKeystore(connection, true);

      state.lastKeystoreTag = encryptedCurrentKeystore.tag;
      chromep.storage.local.set({"keystores": {[state.userID]: encryptedKeystore}});
      updateUserData("lastKeystoreTag", state.lastKeystoreTag);

      // Merge the server keystore with our keystore
      keystore.merge(currentKeystore);

      console.log("Got current keystore, sending merged keystore");
      sendUpdatedKeystore(connection, keystore);
    }
  }

  async function loginFirstTime(connection, masterKey_) {
    if (!isPaired()) {
      throw Error("Cannot login before pairing.");
    }

    const masterKey = await cryptography.expandPassword(masterKey_,
                                                        state.userID);
    state.masterKey = masterKey;

    const encryptedKeystore =
          await cryptography.symmetricEncrypt(state.masterKey, state.keystore.serialize());

    chromep.storage.local.set({"keystores": {[state.userID]: encryptedKeystore}})
      .then(() => {
        console.log("Stored encrypted keystore (first time)");
      });

    // This may be the first time this user has ever logged in, so go
    // ahead and try to send the empty keystore
    sendUpdatedKeystore(connection, state.keystore);
    console.log("Finished First time log in.");
    return true;
  }

  async function login(masterKey_) {
    if (!isPaired()) {
      throw Error("Cannot login before pairing.");
    }

    const providedKey = await cryptography.expandPassword(masterKey_, state.userID);
    console.log("Reading current keystore.");

    const result = await chromep.storage.local.get("keystores");

    if (typeof(result.keystores) === "undefined") {
      console.log("No keystore. First time login.");
      return loginFirstTime(state.connection, masterKey_);
    }

    try {
      const encryptedKeystore = result.keystores[state.userID];

      const decryptedKeystore =
            await cryptography.symmetricDecrypt(providedKey, encryptedKeystore);
      const parsedKeystore = JSON.parse(decryptedKeystore);

      console.log("Used provided key to decrypt current keystore");

      state.keystore = new Keystore(parsedKeystore);
      state.masterKey = providedKey;
      console.log("Getting updated keystore.");
      getCurrentKeystore(state.connection);

      console.log("Finished logging in.");
      return true;
    } catch (error) {
      state.masterKey = null;
      console.error("Error logging in:", error);
      return false;
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

    const userKeys = {
      publicKey: clientKeys.publicKey,
      privateKey: clientKeys.privateKey
    };

    await savePairInfo(remoteServerLocation, username,
                       userID, deviceID, userKeys,
                       serverPubKey);
    state.paired = true;
    console.log("Pairing complete");
    await startup();
    login(masterKey);
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

    await chromep.storage.local.set(data);
    console.log("Saved pairing parameters");
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

    state.connection = new Connection(state.serverAddress,
                                      state.userID,
                                      state.deviceID,
                                      state.userKeys.privateKey,
                                      state.serverPubKey);
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
      sendUpdatedKeystore(state.connection, state.keystore);
    } else if (request.message === "fill-credentials"         ||
               request.message === "fill-generated-password"  ||
               request.message === "close-fill-popup"         ||
               request.message === "request-save-credentials" ||
               request.message === "close-generate-popup") {
      // proxy fill-credentials/close requests for the iframe back to the
      // originating tab
      if (sender.tab) {
        chrome.tabs.sendMessage(sender.tab.id, request);
      } else {
        chrome.tabs.query({currentWindow: true, active : true}, (tabs) => {
          chrome.tabs.sendMessage(tabs[0].id, request);
        });
      }
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
