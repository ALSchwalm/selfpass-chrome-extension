var sjcl = require("../../lib/sjcl.js");

//TODO remove this
var $ = require("../../lib/jquery.js");

var selfpass = (function(){
  var b64 = sjcl.codec.base64;

  function encrypt(userID, key, plaintext){
    var iv = new Uint8Array(12);
    window.crypto.getRandomValues(iv);

    iv = String.fromCharCode.apply(null, iv);
    iv = sjcl.codec.utf8String.toBits(iv);

    const cipher = new sjcl.cipher.aes(b64.toBits(key));

    const pt = sjcl.codec.utf8String.toBits(plaintext);
    const encrypted = sjcl.mode.gcm.encrypt(cipher, pt, iv, [], 128);
    const length = sjcl.bitArray.bitLength(encrypted);
    const ciphertext = sjcl.bitArray.bitSlice(encrypted, 0, length-128);
    const tag = sjcl.bitArray.bitSlice(encrypted, length-128);

    return {
      ciphertext: b64.fromBits(ciphertext),
      tag: b64.fromBits(tag),
      iv: b64.fromBits(iv),
      user_id: userID
    };
  }

  function decrypt(encrypted, key) {
    const cipher = new sjcl.cipher.aes(b64.toBits(key));

    const iv = b64.toBits(encrypted["iv"]);
    const tag = b64.toBits(encrypted["tag"]);
    var ciphertext = b64.toBits(encrypted["ciphertext"]);
    ciphertext = sjcl.bitArray.concat(ciphertext, tag);

    const decrypted = sjcl.mode.gcm.decrypt(cipher, ciphertext, iv);
    return sjcl.codec.utf8String.fromBits(decrypted);
  }

  function expandMasterPass(password, userID) {
    const out = sjcl.misc.pbkdf2(password,
                                 sjcl.codec.utf8String.toBits(userID),
                                 100000,
                                 32*8);
    return b64.fromBits(out);
  }

  var keystore = {};

  function parseUrl(url) {
    const parser = document.createElement('a');
    parser.href = url;
    return parser;
  }

  function saveCredentialsForUrl(url, username, password, favicon) {
    const host = parseUrl(url).host;
    if (typeof(keystore[host]) === "undefined") {
      keystore[host] = [];
    }
    keystore[host].push({
      username: username,
      password: password,
      url: url,
      host: host,
      favicon: favicon
    });
    sendUpdatedKeystore(keystore);
  }

  function credentialsForUrl(url) {
    const host = parseUrl(url).host;
    if (typeof(keystore[host]) === "undefined") {
      return [];
    }

    //TODO return ranking based on URL similarity
    return keystore[host];
  }

  function generateNonce() {
    var nonce = new Uint8Array(8);
    window.crypto.getRandomValues(nonce);
    return btoa(nonce);
  }

  function getCurrentKeystore(callback) {
    sendEncryptedRequest("retrieve-keystore", undefined, function(response){
      var encryptedKeystore = JSON.parse(response["data"]);
      var decryptedKeystore = decrypt(encryptedKeystore, masterKey);
      var parsedKeystore = JSON.parse(decryptedKeystore);

      if (typeof(callback) === "undefined") {
        keystore = parsedKeystore;
      } else {
        callback(parsedKeystore);
      }

      chrome.storage.local.set({"keystores": {[userID]: encryptedKeystore}},
                               function(){
        console.log("Updated keystore");
      });
    });
  }

  function isLoggedIn() {
    return masterKey !== null;
  }

  function sendUpdatedKeystore(keystore) {
    if (!isLoggedIn()) {
      console.error("Cannot sendUpdatedKeystore before logging in.");
      return;
    }
    var encryptedKeystore = encrypt(userID, masterKey, JSON.stringify(keystore));
    sendEncryptedRequest("update-keystore", JSON.stringify(encryptedKeystore));
  }

  var paired = false;
  function isPaired() {
    return !!paired;
  }

  // Backed by local storage
  var userID = null;
  var username = null;
  var accessKey = null;

  // More temporary
  var masterKey = null;

  function init(userID_, username_, accessKey_) {
    userID = userID_;
    username = username_;
    accessKey = accessKey_;
  }

  function loginFirstTime(masterKey_) {
    if (!isPaired()) {
      console.error("Cannot login before pairing.");
      return;
    }
    masterKey = expandMasterPass(masterKey_, userID);
    console.log("Finished First time log in.");

    var encryptedKeystore = encrypt(userID, masterKey, JSON.stringify(keystore));
    chrome.storage.local.set({"keystores": {[userID]: encryptedKeystore}},
                             function(){
      console.log("Stored encrypted keystore (first time)");
    });

    // This should be an empty object. Send it so the server
    // has something stored for the new user.
    sendUpdatedKeystore(keystore);
  }

  function login(masterKey_, onSuccess, onError) {
    if (!isPaired()) {
      console.error("Cannot login before pairing.");
      return;
    }
    const providedKey = expandMasterPass(masterKey_, userID);
    console.log("Reading current keystore.");

    chrome.storage.local.get("keystores", function(result){
      try {
        const encryptedKeystore = result.keystores[userID];
        const decryptedKeystore = decrypt(encryptedKeystore,
                                          providedKey);
        const parsedKeystore = JSON.parse(decryptedKeystore);

        console.log("Used provided key to decrypt current keystore");

        masterKey = providedKey;
        console.log("Getting updated keystore.");
        getCurrentKeystore();

        console.log("Finished logging in.");
        if (onSuccess) {
          onSuccess();
        }
      } catch(err) {
        masterKey = null;
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

    var encryptedPayload = encrypt(userID, accessKey, strPayload);

    $.ajax({
      type: 'POST',
      url: 'http://localhost:4999',
      data: JSON.stringify(encryptedPayload),
      success: function(response) {
        if (typeof(callback) !== "undefined") {
          const decrypted = JSON.parse(decrypt(response, accessKey));

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

  function pairWithNewUser(localServerLocation,
                           remoteServerLocation,
                           username,
                           masterKey) {
    $.ajax({
      type: 'POST',
      url: localServerLocation + '/user/add',
      data: JSON.stringify({username: username}),
      success: function(response) {
        completePair(localServerLocation, response, function(){
          loginFirstTime(masterKey);
        });
      },
      error: function(response) {
        console.error("Failed to pair with new user", response);
      },
      contentType: "application/json",
      dataType: 'json'
    });
  }

  function pairWithExistingUser(localServerLocation,
                                remoteServerLocation,
                                username,
                                masterKey) {
    $.ajax({
      type: "GET",

      //TODO use the provided url (and store it)
      url: localServerLocation + '/user/' + username + '/info',
      success: function(response) {
        completePair(localServerLocation, response, function(){
          login(masterKey);
        });
      },
      error: function(response) {
        console.error("Failed to pair with existing user", response);
      }
    });
  }

  function completePair(serverAddress, response, callback) {
    const userID = response["id"];
    const accessKey = response["access_key"];
    const username = response["username"];

    chrome.storage.local.get("users", function(users){
      users[userID] = {
        accessKey: accessKey,
        username: username
      };
      const data = {
        connectionData : {
          paired: 1,
          serverAddress: serverAddress,
          accessKey: accessKey,
          lastUser: userID,
          users: users
        }
      };

      chrome.storage.local.set(data, function() {
        if (!chrome.extension.lastError) {
          init(userID, username, accessKey);
          console.log("Pairing complete");
          paired = true;

          callback();
        } else {
          console.error("An error occurred while pairing");
        }
      });
    });

  }

  function unpair() {
    if (isLoggedIn()) {
      logout();
    }
    chrome.storage.local.remove("connectionData");
    paired = false;
  }

  function logout() {
    masterKey = null;
    keystore = {};
    console.log("Logged out.");
  }

  function startup() {
    chrome.storage.local.get("connectionData", function(result){
      const connectionData = result.connectionData;

      if (typeof(connectionData) === "undefined") {
        console.log("Unpaired.");
        return;
      }

      const accessKey = connectionData.accessKey;

      const userID = connectionData.lastUser;
      const username = connectionData.users[userID].username;

      paired = connectionData.paired;

      console.log("Already paired.");
      init(userID, username, accessKey);
      console.log("Loaded userID `" + userID + "`(" + username +
                  ") and accessKey `" + accessKey + "`");
    });
  }

  startup();

  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse){
    console.log(request, sender);
    if (request.message === "get-credentials") {
      sendResponse(credentialsForUrl(sender.tab.url));
    } else if (request.message === "get-keystore") {
      sendResponse(keystore);
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
    pairWithExistingUser: pairWithExistingUser,
    pairWithNewUser: pairWithNewUser,
    isPaired: isPaired,
    getCurrentKeystore: getCurrentKeystore,
    credentialsForUrl: credentialsForUrl,
    saveCredentialsForUrl: saveCredentialsForUrl,
    keystore: function(){return keystore;}
  };
})();

window.selfpass = selfpass;
window.sjcl = sjcl;
