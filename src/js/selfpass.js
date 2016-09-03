const sjcl = require("../../lib/sjcl.js");

//TODO remove this
const $ = require("../../lib/jquery.js");

var selfpass = (function(){
  const b64 = sjcl.codec.base64;

  var state = {
    paired: false,
    username: null,
    userID: null,
    keystore: {},

    masterKey: null
  };

  function encrypt(key, plaintext, additionalData){
    let iv = new Uint8Array(12);
    window.crypto.getRandomValues(iv);

    iv = String.fromCharCode.apply(null, iv);
    iv = sjcl.codec.utf8String.toBits(iv);

    const cipher = new sjcl.cipher.aes(b64.toBits(key));

    const pt = sjcl.codec.utf8String.toBits(plaintext);
    const encrypted = sjcl.mode.gcm.encrypt(cipher, pt, iv, [], 128);
    const length = sjcl.bitArray.bitLength(encrypted);
    const ciphertext = sjcl.bitArray.bitSlice(encrypted, 0, length-128);
    const tag = sjcl.bitArray.bitSlice(encrypted, length-128);

    var result = {
      ciphertext: b64.fromBits(ciphertext),
      tag: b64.fromBits(tag),
      iv: b64.fromBits(iv)
    };

    for (let key in additionalData) {
      result[key] = additionalData[key];
    }
    return result;
  }

  function decrypt(encrypted, key) {
    const cipher = new sjcl.cipher.aes(b64.toBits(key));

    const iv = b64.toBits(encrypted["iv"]);
    const tag = b64.toBits(encrypted["tag"]);
    let ciphertext = b64.toBits(encrypted["ciphertext"]);
    ciphertext = sjcl.bitArray.concat(ciphertext, tag);

    const decrypted = sjcl.mode.gcm.decrypt(cipher, ciphertext, iv);
    return sjcl.codec.utf8String.fromBits(decrypted);
  }

  function expandPass(password, salt) {
    const out = sjcl.misc.pbkdf2(password,
                                 sjcl.codec.utf8String.toBits(salt),
                                 100000,
                                 32*8);
    return b64.fromBits(out);
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

  function generateNonce() {
    var nonce = new Uint8Array(8);
    window.crypto.getRandomValues(nonce);
    return btoa(nonce);
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
      return;
    }
    state.masterKey = expandPass(masterKey_, state.userID);
    console.log("Finished First time log in.");

    var encryptedKeystore = encrypt(state.masterKey,
                                    JSON.stringify(state.keystore));
    chrome.storage.local.set({"keystores": {[state.userID]: encryptedKeystore}},
                             function(){
      console.log("Stored encrypted keystore (first time)");
    });

    // This should be an empty object. Send it so the server
    // has something stored for the new user.
    // sendUpdatedKeystore(keystore);
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

  function sendEncryptedRequest(method, data, callback) {
    var payload = {
      "request": method,
      "request-nonce": generateNonce()
    };

    if (typeof(data) !== "undefined") {
      payload["data"] = data;
    }

    var strPayload = JSON.stringify(payload);

    var encryptedPayload = encrypt(state.userID, state.accessKey, strPayload);

    $.ajax({
      type: 'POST',
      url: 'http://localhost:4999',
      data: JSON.stringify(encryptedPayload),
      success: function(response) {
        if (typeof(callback) !== "undefined") {
          const decrypted = JSON.parse(decrypt(response, state.accessKey));

          if (decrypted["request-nonce"] === payload["request-nonce"]) {
            callback(decrypted);
          } else {
            console.error("Incorrect nonce.");
          }
        }
      },
      error: function(response) {
        console.error("An error occurred while fulfilling request");
      },
      contentType: "application/json",
      dataType: 'json'
    });
  }

  function pairDevice(combinedAccessKey,
                      remoteServerLocation,
                      username,
                      masterKey) {
    const userID = b64.fromBits(sjcl.hash.sha256.hash(username));
    const deviceID = generateDeviceID();

    const [accessKeyID, accessKey] = [combinedAccessKey.slice(0, 2),
                                      combinedAccessKey.slice(2)];

    // Expand the access key to a GCM key, use the userID as the salt
    const expandedAccessKey = expandPass(accessKey.replace(/-/g, ''), userID);

    // The long-lived key used for authentication in the ECDHE
    const keys = sjcl.ecc.ecdsa.generateKeys(521);

    const pub = keys.pub;
    const priv = keys.sec;
    const point = pub.get();

    const message = {
      request: "register-device",
      device_id: deviceID,
      ecc: {
        x: b64.fromBits(point.x),
        y: b64.fromBits(point.y)
      }
    };

    const payload = encrypt(expandedAccessKey,
                            JSON.stringify(message),
                            {
                              user_id: userID,
                              access_key_id: accessKeyID
                            });

    $.ajax({
      type: 'POST',
      url: remoteServerLocation + "/pair",
      data: JSON.stringify(payload),
      contentType: "application/json",
      dataType: 'json',
      success: function(encryptedResponse) {
        const responseStr = decrypt(encryptedResponse, expandedAccessKey);
        const response = JSON.parse(responseStr);
        const point = response.ecc;

        const Xbits = b64.toBits(point.x);
        const Ybits = b64.toBits(point.y);

        const pointBits = sjcl.bitArray.concat(Xbits, Ybits);

        const serverPubKey = new sjcl.ecc.ecdsa.publicKey(sjcl.ecc.curves["c521"],
                                                            pointBits);
        const userSignatureKeys = {
          pub: pub,
          priv: priv
        };
        completePair(remoteServerLocation, masterKey, username,
                     userID, deviceID, userSignatureKeys,
                     serverPubKey, loginFirstTime);
      },
      error: function() {
        console.error("An error occurred while pairing device.");
      }
    });
  }

  function completePair(serverAddress, masterKey,
                        username, userID, deviceID,
                        userKeys, serverPubKey,
                        onComplete, onError) {
    chrome.storage.local.get("users", function(users){
      users[userID] = {
        username: username,
        keys: userKeys
      };
      const data = {
        connectionData : {
          paired: 1,
          serverAddress: serverAddress,
          serverPubKey: serverPubKey,
          lastUser: userID,
          users: users
        }
      };

      chrome.storage.local.set(data, function() {
        if (!chrome.extension.lastError) {
          init(userID, username);
          console.log("Pairing complete");
          state.paired = true;

          if (typeof(onComplete) !== "undefined") {
            onComplete(masterKey);
          }
        } else {
          console.error("An error occurred while pairing");
          if (typeof(onError) !== "undefined") {
            onError();
          }
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
    chrome.storage.local.get("connectionData", function(result){
      const connectionData = result.connectionData;

      if (typeof(connectionData) === "undefined") {
        console.log("Unpaired.");
        return;
      }

      const userID = connectionData.lastUser;
      const username = connectionData.users[userID].username;

      state.paired = connectionData.paired;

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
window.sjcl = sjcl;
