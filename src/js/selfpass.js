var sjcl = require("../../lib/sjcl.js");
var $ = require("../../lib/jquery.js");

var selfpass = (function(){
  var b64 = sjcl.codec.base64;

  function encrypt(user_id, key, plaintext){
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
      user_id: user_id
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

  function expand_master_pass(password, user_id) {
    var out = sjcl.misc.pbkdf2(password,
                               sjcl.codec.utf8String.toBits(user_id),
                               100000,
                               32*8);
    return b64.fromBits(out);
  }

  var keystore = {};

  function parse_url(url) {
    var parser = document.createElement('a');
    parser.href = url;
    return parser;
  }

  function save_credentials_for_url(url, username, password) {
    var host = parse_url(url).host;
    if (typeof(keystore[host]) === "undefined") {
      keystore[host] = [];
    }
    keystore[host].push({
      username: username,
      password: password,
      url: url
    });
    send_updated_keystore(keystore);
  }

  function credentials_for_url(url) {
    var host = parse_url(url).host;
    if (typeof(keystore[host]) === "undefined") {
      return [];
    }

    //TODO return ranking based on URL similarity
    for (var i in keystore[host]) {
      var creds = keystore[host][i];
      if (creds.url === url) {
        return [creds];
      }
    }
    return [];
  }

  function generate_nonce() {
    var nonce = new Uint8Array(8);
    window.crypto.getRandomValues(nonce);
    return btoa(nonce);
  }

  function get_current_keystore(callback) {
    send_request("retrieve-keystore", undefined, function(response){
      var encrypted_keystore = JSON.parse(response["data"]);
      var decrypted_keystore = decrypt(encrypted_keystore, master_key);

      if (typeof(callback) === "undefined") {
        keystore = JSON.parse(decrypted_keystore);
      } else {
        callback(JSON.parse(decrypted_keystore));
      }
    });
  }

  function is_logged_in() {
    return master_key !== null;
  }

  function send_updated_keystore(keystore) {
    if (!is_logged_in()) {
      console.error("Cannot send_updated_keystore before logging in.");
      return;
    }
    var encrypted_keystore = encrypt(user_id, master_key, JSON.stringify(keystore));
    send_request("update-keystore", JSON.stringify(encrypted_keystore));
  }

  var paired = false;
  function is_paired() {
    return !!paired;
  }

  // Backed by local storage
  var user_id = null;
  var access_key = null;

  // More temporary
  var master_key = null;

  function init(user_id_, access_key_) {
    user_id = user_id_;
    access_key = access_key_;
  }

  function login(master_key_) {
    if (!is_paired()) {
      console.error("Cannot login before pairing.");
      return;
    }
    master_key = expand_master_pass(master_key_, user_id);
    console.log("Finished logging in.");
  }

  function send_request(method, data, callback) {
    var payload = {
      "request": method,
      "request-nonce": generate_nonce()
    };

    if (typeof(data) !== "undefined") {
      payload["data"] = data;
    }

    var str_payload = JSON.stringify(payload);

    var encrypted_payload = encrypt(user_id, access_key, str_payload);

    $.ajax({
      type: 'POST',
      url: 'http://localhost:4999',
      data: JSON.stringify(encrypted_payload),
      success: function(response) {
        if (typeof(callback) !== "undefined") {
          var decrypted = JSON.parse(decrypt(response, access_key));

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

  function pair_with_new_user(management_url, username, master_key) {
    $.ajax({
      type: 'POST',
      url: 'http://localhost:5000/user/add',
      data: JSON.stringify({username: username}),
      success: function(response) {
        complete_pair(response, function(){
          login(master_key);

          // This should be an empty object. Send it so the server
          // has something stored for the new user.
          send_updated_keystore(keystore);
        });
      },
      error: function(response) {
        console.error("Failed to pair with new user", response);
      },
      contentType: "application/json",
      dataType: 'json'
    });
  }

  function pair_with_existing_user(management_url, username, master_key) {
    $.ajax({
      type: "GET",
      url: 'http://localhost:5000/user/' + username + '/info',
      success: function(response) {
        complete_pair(response, function(){
          login(master_key);
        });
      },
      error: function(response) {
        console.error("Failed to pair with existing user", response);
      }
    });
  }

  function complete_pair(response, callback) {
    chrome.storage.local.set({"user_id": response["id"]}, function(user_id){
      chrome.storage.local.set({"access_key": response["access_key"]}, function(access_key){
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
    chrome.storage.local.remove("user_id");
    chrome.storage.local.remove("access_key");
    chrome.storage.local.remove("paired");
    paired = false;
  }

  function logout() {
    master_key = null;
    console.log("Logged out.");
  }

  function startup() {
    chrome.storage.local.get("user_id", function(result){
      var user_id = result.user_id;
      chrome.storage.local.get("access_key", function(result){
        var access_key = result.access_key;
        chrome.storage.local.get("paired", function(result){
          if (typeof(user_id) === "undefined" ||
              typeof(access_key) === "undefined" ||
              typeof(result.paired) === "undefined") {

            console.log("Unpaired.");
            return;
          }

          paired = result.paired;

          console.log("Already paired.");
          init(user_id, access_key);
          console.log("Loaded user_id `" + user_id + "` and access_key `" + access_key + "`");
        });
      });
    });
  }

  startup();

  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse){
    if (request === "get-credentials") {
      sendResponse(credentials_for_url(sender.url));
    }
  });

  return {
    login: login,
    logout: logout,
    is_logged_in: is_logged_in,
    unpair: unpair,
    pair_with_existing_user: pair_with_existing_user,
    is_paired: is_paired,
    credentials_for_url:credentials_for_url,
    save_credentials_for_url:save_credentials_for_url,
    keystore: function(){return keystore;}
  };
})();

window.selfpass = selfpass;
