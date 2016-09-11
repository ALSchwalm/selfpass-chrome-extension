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
    symmetricEncrypt: function(key, plaintext){
      let iv = new Uint8Array(12);
      window.crypto.getRandomValues(iv);

      const encoder = new window.TextEncoder("utf-8");
      const encodedPlaintext = encoder.encode(plaintext);

      return window.crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: iv,
          tagLength: 128
        },
        key,
        encodedPlaintext
      ).then((encryptedView) => {
        const encryptedBytes = new Uint8Array(encryptedView);
        return {
          ciphertext: base64.fromByteArray(encryptedBytes.slice(0, -16)),
          tag: base64.fromByteArray(encryptedBytes.slice(-16)),
          iv: base64.fromByteArray(iv)
        };
      });
    },

    symmetricDecrypt: function(key, ciphertextObj) {
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

      return window.crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: iv,
          tagLength: 128
        },
        key,
        ciphertextWithTag
      ).then((decryptedView) => {
        return new Uint8Array(decryptedView);
      });
    },

    expandPassword: function(password, salt) {
      return Promise.all([password, salt]).then(([password, salt]) => {
        const encoder = new window.TextEncoder("utf-8");
        const encodedPassword = encoder.encode(password);
        const encodedSalt = encoder.encode(salt);

        return window.crypto.subtle.importKey(
          "raw",
          encodedPassword,
          {
            name: "PBKDF2"
          },
          false,
          ["deriveKey"]
        ).then(function(key){
          return window.crypto.subtle.deriveKey(
            {
              "name": "PBKDF2",
              salt: encodedSalt,
              iterations: 100000,
              hash: "SHA-256"
            },
            key,
            {"name": "AES-GCM", length: 256},
            true,
            ["encrypt", "decrypt"]
          );
        });
      });
    },

    sha256: function(str) {
      var buffer = new window.TextEncoder("utf-8").encode(str);
      return window.crypto.subtle.digest("SHA-256", buffer).then(raw => {
        return base64.fromByteArray(new Uint8Array(raw));
      });
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
    }
  };

  function sendEncryptedRequest(method, data, callback) {
    const tempKeys = sjcl.ecc.elGamal.generateKeys(384);
    const tempPub = tempKeys.pub;
    const tempPriv = tempKeys.sec;
    const tempPoint = tempPub.get();

    const payload = {
      public_key: crypto.publicKeyToJSON(tempPub)
    };

    const encodedPayload = b64.fromBits(
      sjcl.codec.utf8String.toBits(JSON.stringify(payload)));

    const payloadHash = sjcl.hash.sha256.hash(encodedPayload);

    console.log("public_key:", crypto.publicKeyToJSON(state.userKeys.pub));
    console.log("Computed hash:", b64.fromBits(payloadHash));

    const signature = state.userKeys.priv.sign(payloadHash);

    const signatureLength = sjcl.bitArray.bitLength(signature);
    const r = sjcl.bitArray.bitSlice(signature, 0, signatureLength/2);
    const s = sjcl.bitArray.bitSlice(signature, signatureLength/2, signatureLength);

    const message = {
      payload: encodedPayload,
      signature: {
        r: b64.fromBits(r),
        s: b64.fromBits(s)
      },
      user_id: state.userID,
      device_id: state.deviceID
    };

    $.ajax({
      type: "POST",
      url: state.serverAddress + "/hello",
      data: JSON.stringify(message),
      contentType: "application/json",
      dataType: 'json',
      success: function(response) {
        const payloadHash = sjcl.hash.sha256.hash(response.payload);
        const signature = crypto.signatureFromJSON(response.signature);
        state.serverPubKey.verify(payloadHash, signature);

        const serverTempPubKey = crypto.publicKeyFromJSON(
          JSON.parse(atob(response.payload)).public_key);

        console.log(b64.fromBits(tempPriv.dh(serverTempPubKey)));
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
    sendEncryptedRequest("retrieve-keystore", undefined, function(response){
      var encryptedKeystore = JSON.parse(response["data"]);
      var decryptedKeystore = decrypt(encryptedKeystore, state.masterKey);
      var parsedKeystore = JSON.parse(decryptedKeystore);

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

  function sendUpdatedKeystore(keystore) {
    if (!isLoggedIn()) {
      console.error("Cannot sendUpdatedKeystore before logging in.");
      return;
    }
    var encryptedKeystore = encrypt(state.userID, state.masterKey,
                                    JSON.stringify(keystore));
    sendEncryptedRequest("update-keystore", JSON.stringify(encryptedKeystore));
  }

  function isPaired() {
    return !!state.paired;
  }

  function init(userID_, username_) {
    state.userID = userID_;
    state.username = username_;
  }

  function loginFirstTime(masterKey_) {
    if (!isPaired()) {
      console.error("Cannot login before pairing.");
      return null;
    }

    return cryptography.expandPassword(masterKey_, state.userID).then(masterKey => {
      state.masterKey = masterKey;
      console.log("Finished First time log in.");

      cryptography.symmetricEncrypt(state.masterKey,
                                    JSON.stringify(state.keystore))
        .then(encryptedKeystore => {

          chrome.storage.local.set(
            {"keystores": {[state.userID]: encryptedKeystore}},
            function(){
              console.log("Stored encrypted keystore (first time)");
            });

          // This should be an empty object. Send it so the server
          // has something stored for the new user.
          // sendUpdatedKeystore(state.keystore);
        });
    });
  }

  function login(masterKey_, onSuccess, onError) {
    if (!isPaired()) {
      console.error("Cannot login before pairing.");
      return;
    }
    const providedKey = expandPass(masterKey_, state.userID);
    console.log("Reading current keystore.");

    chrome.storage.local.get("keystores", function(result){
      try {
        const encryptedKeystore = result.keystores[state.userID];
        const decryptedKeystore = decrypt(encryptedKeystore,
                                          providedKey);
        const parsedKeystore = JSON.parse(decryptedKeystore);

        console.log("Used provided key to decrypt current keystore");

        state.masterKey = providedKey;
        console.log("Getting updated keystore.");
        getCurrentKeystore();

        console.log("Finished logging in.");
        if (onSuccess) {
          onSuccess();
        }
      } catch(err) {
        state.masterKey = null;
        console.log("Error logging in:", err);
        if (onError) {
          onError(err);
        }
      }
    });
  }

  function generatePairingInfo(combinedAccessKey, username) {
    const userID = cryptography.sha256(username);
    const deviceID = generateDeviceID();
    const [accessKeyID, accessKey] = [combinedAccessKey.slice(0, 2),
                                      combinedAccessKey.slice(2)];

    const expandedAccessKey = cryptography.expandPassword(
      accessKey.replace(/-/g, ''), userID);

    const clientKeys = cryptography.generateECDSAKeys();

    const payload = Promise.all([userID, expandedAccessKey, clientKeys]).then(
      ([userID, expandedAccessKey, clientKeys]) => {

        const pub = clientKeys.publicKey;

        return window.crypto.subtle.exportKey("jwk", pub).then(exportedClientPub => {
          console.log("Exported client key: ", exportedClientPub);
          const message = {
            request: "register-device",
            device_id: deviceID,
            public_key: exportedClientPub
          };
          return cryptography.symmetricEncrypt(expandedAccessKey,
                                               JSON.stringify(message))
            .then(payload => {
              payload["user_id"] = userID;
              payload["access_key_id"] = accessKeyID;
              return payload;
            });
        });
    });

    return Promise.all([userID, deviceID, expandedAccessKey, clientKeys, payload]);
  }

  function pairDevice(combinedAccessKey,
                      remoteServerLocation,
                      username,
                      masterKey) {
    return generatePairingInfo(combinedAccessKey, username)
      .then(([userID, deviceID, expandedAccessKey, clientKeys, payload]) => {
      $.ajax({
        type: 'POST',
        url: remoteServerLocation + "/pair",
        data: JSON.stringify(payload),
        contentType: "application/json",
        dataType: 'json',
        success: function(encryptedResponse) {
          cryptography.symmetricDecrypt(expandedAccessKey,
                                        encryptedResponse).then(response => {
            const decoder = new window.TextDecoder("utf-8");
            const decodedResponse = decoder.decode(response);

            const message = JSON.parse(decodedResponse);

            return window.crypto.subtle.importKey(
              "jwk",
              message.public_key,
              {
                name: "ECDSA",
                namedCurve: "P-384"
              },
              true,
              ["verify"]);
          }).then(serverKey => {
            state.serverPubKey = serverKey;
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
          });
        },
        error: function() {
          console.error("An error occurred while pairing device.");
        }
      });
    });
  }

  function savePairInfo(serverAddress, username, userID, deviceID,
                        userKeys, serverPubKey) {
    const exportedUserPub = window.crypto.subtle.exportKey("jwk", userKeys.publicKey);
    const exportedUserPriv = window.crypto.subtle.exportKey("jwk", userKeys.privateKey);
    const exportedServerPub = window.crypto.subtle.exportKey("jwk", serverPubKey);

    return Promise.all([exportedUserPub, exportedUserPriv, exportedServerPub])
      .then(([exportedUserPub, exportedUserPriv, exportedServerPub]) => {
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
    chrome.storage.local.get("connectionData", function(result){
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

      const loadServerPubKey = window.crypto.subtle.importKey(
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
      const loadClientPub = window.crypto.subtle.importKey(
        "jwk",
        user.keys.publicKey,
        {
          name: "ECDSA",
          namedCurve: "P-384"
        },
        false,
        []
      );

      const loadClientPriv = window.crypto.subtle.importKey(
        "jwk",
        user.keys.privateKey,
        {
          name: "ECDSA",
          namedCurve: "P-384"
        },
        false,
        ["sign"]
      );

      Promise.all([loadServerPubKey, loadClientPub, loadClientPriv])
        .then(([serverPubKey, clientPub, clientPriv]) => {
          state.serverPubKey = serverPubKey;
          state.userKeys = {
            privateKey: clientPriv,
            publicKey: clientPub
          };
        }).then(() => {
          console.log("Already paired.");
          init(userID, username);
          console.log("Loaded user `" + username + "` (" + userID + ")");
        });
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
