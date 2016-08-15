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

    var cipher = new sjcl.cipher.aes(b64.toBits(key));

    var pt = sjcl.codec.utf8String.toBits(plaintext);
    var encrypted = sjcl.mode.gcm.encrypt(cipher, pt, iv, [], 128);
    var length = sjcl.bitArray.bitLength(encrypted);
    var ciphertext = sjcl.bitArray.bitSlice(encrypted, 0, length-128);
    var tag = sjcl.bitArray.bitSlice(encrypted, length-128);

    return {
      ciphertext: b64.fromBits(ciphertext),
      tag: b64.fromBits(tag),
      iv: b64.fromBits(iv),
      user_id: userID
    };
  }

  function decrypt(encrypted, key) {
    var cipher = new sjcl.cipher.aes(b64.toBits(key));

    var iv = b64.toBits(encrypted["iv"]);
    var tag = b64.toBits(encrypted["tag"]);
    var ciphertext = b64.toBits(encrypted["ciphertext"]);
    ciphertext = sjcl.bitArray.concat(ciphertext, tag);

    var decrypted = sjcl.mode.gcm.decrypt(cipher, ciphertext, iv);
    return sjcl.codec.utf8String.fromBits(decrypted);
  }

  function expandMasterPass(password, userID) {
    var out = sjcl.misc.pbkdf2(password,
                               sjcl.codec.utf8String.toBits(userID),
                               100000,
                               32*8);
    return b64.fromBits(out);
  }

  var keystore = {};

  function parseUrl(url) {
    var parser = document.createElement('a');
    parser.href = url;
    return parser;
  }

  function saveCredentialsForUrl(url, username, password) {
    var host = parseUrl(url).host;
    if (typeof(keystore[host]) === "undefined") {
      keystore[host] = [];
    }
    keystore[host].push({
      username: username,
      password: password,
      url: url,
      host: host
    });
    sendUpdatedKeystore(keystore);
  }

  function credentialsForUrl(url) {
    var host = parseUrl(url).host;
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

      if (typeof(callback) === "undefined") {
        keystore = JSON.parse(decryptedKeystore);
        console.log("Updated keystore");
      } else {
        callback(JSON.parse(decryptedKeystore));
      }
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
  var accessKey = null;

  // More temporary
  var masterKey = null;

  function init(userID_, accessKey_) {
    userID = userID_;
    accessKey = accessKey_;
  }

  function login(masterKey_) {
    if (!isPaired()) {
      console.error("Cannot login before pairing.");
      return;
    }
    masterKey = expandMasterPass(masterKey_, userID);
    console.log("Finished logging in.");
    console.log("Getting current keystore.");
    getCurrentKeystore();
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
          var decrypted = JSON.parse(decrypt(response, accessKey));

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

  function pairWithNewUser(managementUrl, username, masterKey) {
    $.ajax({
      type: 'POST',
      url: 'http://localhost:5000/user/add',
      data: JSON.stringify({username: username}),
      success: function(response) {
        completePair(response, function(){
          login(masterKey);

          // This should be an empty object. Send it so the server
          // has something stored for the new user.
          sendUpdatedKeystore(keystore);
        });
      },
      error: function(response) {
        console.error("Failed to pair with new user", response);
      },
      contentType: "application/json",
      dataType: 'json'
    });
  }

  function pairWithExistingUser(managementUrl, username, masterKey) {
    $.ajax({
      type: "GET",

      //TODO use the provided url (and store it)
      url: 'http://localhost:5000/user/' + username + '/info',
      success: function(response) {
        completePair(response, function(){
          login(masterKey);
        });
      },
      error: function(response) {
        console.error("Failed to pair with existing user", response);
      }
    });
  }

  function completePair(response, callback) {
    chrome.storage.local.set({"userID": response["id"]}, function(userID){
      chrome.storage.local.set({"accessKey": response["access_key"]}, function(accessKey){
        chrome.storage.local.set({"paired": 1}, function(){
          if (!chrome.extension.lastError) {
            init(response["id"], response["access_key"]);
            console.log("Pairing complete");
            paired = true;

            callback();
          } else {
            console.error("An error occurred while pairing");
          }
        });
      });
    });
  }

  function unpair() {
    chrome.storage.local.remove("userID");
    chrome.storage.local.remove("accessKey");
    chrome.storage.local.remove("paired");
    paired = false;
  }

  function logout() {
    masterKey = null;
    console.log("Logged out.");
  }

  function startup() {
    chrome.storage.local.get("userID", function(result){
      var userID = result.userID;
      chrome.storage.local.get("accessKey", function(result){
        var accessKey = result.accessKey;
        chrome.storage.local.get("paired", function(result){
          if (typeof(userID) === "undefined" ||
              typeof(accessKey) === "undefined" ||
              typeof(result.paired) === "undefined") {

            console.log("Unpaired.");
            return;
          }

          paired = result.paired;

          console.log("Already paired.");
          init(userID, accessKey);
          console.log("Loaded userID `" + userID + "` and accessKey `" + accessKey + "`");
        });
      });
    });
  }

  startup();

  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse){
    console.log(request, sender);
    if (request.message === "get-credentials") {
      sendResponse(credentialsForUrl(sender.tab.url));
    } else if (request.message === "fill-credentials") {
      // proxy fill-credentials requests for the iframe back to the
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
