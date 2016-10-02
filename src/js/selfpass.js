import $ from "jquery";
import base64 from "base64-js";

var selfpass = (function(){
  var state = {
    paired: false,
    username: null,
    userID: null,
    deviceID: null,
    userKeys: null,
    serverAddress: null,
    serverPubKey: null,
    keystore: {},

    masterKey: null
  };

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

  async function sendEncryptedRequest(method, data, callback) {
    const tempKeys = await cryptography.generateECDHKeys();
    const tempPubKey = tempKeys.publicKey;
    const tempPrivKey = tempKeys.privateKey;

    const exportedPubKey = await window.crypto.subtle.exportKey("jwk", tempPubKey);
    const pubKeyStr = window.btoa(JSON.stringify({
      public_key: exportedPubKey
    }));

    const signature = await cryptography.signECDSA(state.userKeys.privateKey,
                                                   pubKeyStr);
    const message = {
      payload: pubKeyStr,
      signature: signature,
      user_id: state.userID,
      device_id: state.deviceID
    };

    $.ajax({
      type: "POST",
      url: state.serverAddress + "/hello",
      data: JSON.stringify(message),
      contentType: "application/json",
      dataType: 'json',
      success: async function(response) {
        const [tempSharedKey, session_id] =
                await completeHello(tempPrivKey, response);

        const message = {
          "request": method,
          "data": data
        };
        const payload = await cryptography.symmetricEncrypt(tempSharedKey,
                                                            JSON.stringify(message));

        payload["session_id"] = session_id;

        $.ajax({
          type: "POST",
          url: state.serverAddress + "/request",
          data: JSON.stringify(payload),
          contentType: "application/json",
          dataType: 'json',
          success: async function(response){
            if (typeof(callback) !== "undefined") {
              const decrypted_response =
                await cryptography.symmetricDecrypt(tempSharedKey, response);
              const decoded_response = JSON.parse(decrypted_response);
              console.log(decoded_response);
              callback(decoded_response);
            }
          }
        });
      }
    });
  }

  function parseUrl(url) {
    const parser = document.createElement('a');
    parser.href = url;
    return parser;
  }

  function saveCredentialsForUrl(url, username, password, favicon) {
    const host = parseUrl(url).host;
    if (typeof(state.keystore[host]) === "undefined") {
      state.keystore[host] = [];
    }
    state.keystore[host].push({
      username: username,
      password: password,
      url: url,
      host: host,
      favicon: favicon
    });
    sendUpdatedKeystore(state.keystore);
  }

  function credentialsForUrl(url) {
    const host = parseUrl(url).host;
    if (typeof(state.keystore[host]) === "undefined") {
      return [];
    }

    //TODO return ranking based on URL similarity
    return state.keystore[host];
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

  function getCurrentKeystore(callback) {
    sendEncryptedRequest("retrieve-keystore", undefined, async function(response){
      const encryptedKeystore = JSON.parse(response["data"]);
      const decryptedKeystore =
        await cryptography.symmetricDecrypt(state.masterKey, encryptedKeystore);
      const parsedKeystore = JSON.parse(decryptedKeystore);

      if (typeof(callback) === "undefined") {
        state.keystore = parsedKeystore;
      } else {
        callback(parsedKeystore);
      }

      chrome.storage.local.set({"keystores": {[state.userID]: encryptedKeystore}},
                               function(){
        console.log("Updated keystore");
      });
    });
  }

  function isLoggedIn() {
    return state.masterKey !== null;
  }

  async function sendUpdatedKeystore(keystore) {
    if (!isLoggedIn()) {
      throw Error("Cannot sendUpdatedKeystore before logging in.");
    }

    const encryptedKeystore =
            await cryptography.symmetricEncrypt(state.masterKey, JSON.stringify(keystore));
    encryptedKeystore["user_id"] = state.userID;
    sendEncryptedRequest("update-keystore", JSON.stringify(encryptedKeystore));
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
            await cryptography.symmetricEncrypt(state.masterKey, JSON.stringify(state.keystore));

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

        state.keystore = parsedKeystore;
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

    $.ajax({
      type: 'POST',
      url: remoteServerLocation + "/pair",
      data: JSON.stringify(payload),
      contentType: "application/json",
      dataType: 'json',
      success: async function(encryptedResponse) {
        const response = await cryptography.symmetricDecrypt(expandedAccessKey,
                                                             encryptedResponse);
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
        },
        error: function() {
          console.error("An error occurred while pairing device.");
        }
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
    state.paired = false;
  }

  function logout() {
    state.masterKey = null;
    state.keystore = {};
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
      sendResponse(credentialsForUrl(sender.tab.url));
    } else if (request.message === "get-keystore") {
      sendResponse(state.keystore);
    } else if (request.message === "login-status") {
      sendResponse({isLoggedIn:isLoggedIn()});
    } else if (request.message === "logout") {
      logout();
    } else if (request.message === "save-credentials") {
      saveCredentialsForUrl(request.url,
                            request.username,
                            request.password,
                            request.favicon);
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
    credentialsForUrl: credentialsForUrl,
    saveCredentialsForUrl: saveCredentialsForUrl,
    keystore: function(){return state.keystore;},
    state: function(){return state;}
  };
})();

window.selfpass = selfpass;
