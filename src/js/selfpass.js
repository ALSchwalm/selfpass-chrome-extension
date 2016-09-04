const sjcl = require("../../lib/sjcl.js");

//TODO remove this
const $ = require("../../lib/jquery.js");

var selfpass = (function(){
  const b64 = sjcl.codec.base64;

  var state = {
    paired: false,
    username: null,
    userID: null,
    userKeys: null,
    serverPubKey: null,
    keystore: {},

    masterKey: null
  };

  const crypto = {
    publicKeyToJSON: function(publicKey) {
      const point = publicKey.get();
      return {
        x: b64.fromBits(point.x),
        y: b64.fromBits(point.y)
      };
    },

    publicKeyFromJSON: function(js) {
      const Xbits = b64.toBits(js.x);
      const Ybits = b64.toBits(js.y);

      const pointBits = sjcl.bitArray.concat(Xbits, Ybits);
      return new sjcl.ecc.ecdsa.publicKey(sjcl.ecc.curves["c521"],
                                          pointBits);
    }
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

  function sendEncryptedRequest(url, method, data, callback) {
    const tempKeys = sjcl.ecc.elGamal.generateKeys(521);
    const tempPub = tempKeys.pub;
    const tempPriv = tempKeys.sec;
    const tempPoint = tempPub.get();

    const payload = {
      public_key: crypto.publicKeyToJSON(tempPub)
    };

    const encodedPayload = b64.fromBits(
      sjcl.codec.utf8String.toBits(JSON.stringify(payload)));

    const payloadHash = sjcl.hash.sha256.hash(encodedPayload);
    const signature = b64.fromBits(state.userKeys.priv.sign(payloadHash));

    const message = {
      payload: encodedPayload,
      signature: signature
    };

    console.log(message);
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
    sendUpdatedKeystore(state.keystore);
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

    const message = {
      request: "register-device",
      device_id: deviceID,
      public_key: crypto.publicKeyToJSON(pub)
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

        // Verify that the point is on the curve
        state.serverPubKey = crypto.publicKeyFromJSON(response.public_key);
        state.userKeys = {
          pub: pub,
          priv: priv
        };

        const userSignatureKeys = {
          pub: pub.serialize(),
          priv: priv.serialize()
        };

        completePair(remoteServerLocation, masterKey, username,
                     userID, deviceID, userSignatureKeys,
                     state.serverPubKey, loginFirstTime);
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

    const serverPubKeySerialized = serverPubKey.serialize();

    chrome.storage.local.get("users", function(users){
      users[userID] = {
        username: username,
        keys: userKeys
      };
      const data = {
        connectionData : {
          paired: true,
          serverAddress: serverAddress,
          serverPubKey: serverPubKeySerialized,
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
      const user = connectionData.users[userID];
      const username = user.username;

      state.paired = connectionData.paired;
      state.serverAddress = connectionData.serverAddress;
      state.serverPubKey = sjcl.ecc.deserialize(connectionData.serverPubKey);
      state.userKeys = {
        priv: sjcl.ecc.deserialize(user.keys.priv),
        pub: sjcl.ecc.deserialize(user.keys.pub)
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
window.sjcl = sjcl;
